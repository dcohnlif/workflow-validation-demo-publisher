/**
 * Use Claude vision to identify click targets in screenshots, then draw
 * callouts directly onto the images before uploading to Arcade.
 *
 * This bypasses the Arcade editor UI entirely -- callouts are baked into
 * the screenshots as visual overlays.
 */
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { promisify } from 'node:util';
import * as logger from '../util/logger.js';

const execFileAsync = promisify(execFile);

interface ClickTarget {
  x: number;  // pixel coordinate in the image
  y: number;
}

/**
 * Use Claude vision to find where a UI element is in a screenshot.
 * Returns normalized coordinates (0-1) for the click target.
 */
async function findClickTarget(
  imagePath: string,
  actionDescription: string,
): Promise<ClickTarget | null> {
  const imageData = readFileSync(imagePath);
  const base64 = imageData.toString('base64');
  const mimeType = 'image/png';

  // Get image dimensions for coordinate conversion
  const { stdout: dims } = await execFileAsync('python3', ['-c', `
from PIL import Image
img = Image.open("${imagePath}")
print(f"{img.width},{img.height}")
`]);
  const [imgWidth, imgHeight] = dims.trim().split(',').map(Number);

  // Use the raw Anthropic client for vision (our generate() helper doesn't support images)
  const vertexProject = process.env.ANTHROPIC_VERTEX_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const vertexRegion = process.env.CLOUD_ML_REGION ?? process.env.VERTEX_LOCATION ?? 'us-east5';

  let client: import('@anthropic-ai/sdk').default;
  if (vertexProject) {
    const { AnthropicVertex } = await import('@anthropic-ai/vertex-sdk');
    client = new AnthropicVertex({ projectId: vertexProject, region: vertexRegion }) as unknown as import('@anthropic-ai/sdk').default;
  } else {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6@default',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 },
          },
          {
            type: 'text',
            text: `The user performed this action: "${actionDescription}"

Find the UI element that was interacted with. Return ONLY a JSON object with the pixel coordinates of the CENTER of that element:
{"x": <number>, "y": <number>}

The image is ${imgWidth}x${imgHeight} pixels. Return coordinates within those bounds. Return ONLY the JSON, nothing else.`,
          },
        ],
      }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => 'text' in b ? b.text : '')
      .join('');

    const startIdx = text.indexOf('{');
    const endIdx = text.indexOf('}', startIdx);
    const match = startIdx >= 0 && endIdx > startIdx ? [text.slice(startIdx, endIdx + 1)] : null;
    if (!match) return null;

    const coords = JSON.parse(match[0]) as { x: number; y: number };
    if (typeof coords.x !== 'number' || typeof coords.y !== 'number') return null;

    // Clamp to image bounds
    return {
      x: Math.max(0, Math.min(coords.x, imgWidth)),
      y: Math.max(0, Math.min(coords.y, imgHeight)),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Vision call failed', { error: msg });
    return null;
  }
}

/**
 * Draw a callout box onto a screenshot using Python/PIL.
 * The callout is positioned near the click target with an arrow pointing to it.
 */
async function drawCallout(
  imagePath: string,
  outputPath: string,
  target: ClickTarget | null,
  calloutText: string,
): Promise<void> {
  // Escape the callout text for Python
  const escapedText = calloutText.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

  const pythonScript = `
import sys
from PIL import Image, ImageDraw, ImageFont

img = Image.open("${imagePath}")
draw = ImageDraw.Draw(img, 'RGBA')
w, h = img.size

# Callout settings
text = "${escapedText}"
padding = 16
max_text_width = min(400, w // 3)
font_size = 18

# Try to get a good font
font = None
for font_path in [
    "/usr/share/fonts/google-noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf",
    "/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]:
    try:
        font = ImageFont.truetype(font_path, font_size)
        break
    except (OSError, IOError):
        continue
if font is None:
    font = ImageFont.load_default()

# Word wrap the text
words = text.split()
lines = []
current_line = ""
for word in words:
    test_line = f"{current_line} {word}".strip()
    bbox = draw.textbbox((0, 0), test_line, font=font)
    if bbox[2] - bbox[0] > max_text_width and current_line:
        lines.append(current_line)
        current_line = word
    else:
        current_line = test_line
if current_line:
    lines.append(current_line)

# Calculate text block size
line_height = font_size + 4
text_height = len(lines) * line_height
text_width = max(draw.textbbox((0, 0), line, font=font)[2] for line in lines) if lines else 100

# Box dimensions
box_w = text_width + padding * 2
box_h = text_height + padding * 2

# Position the callout
target_x = ${target?.x ?? 'w // 2'}
target_y = ${target?.y ?? 'h // 2'}

# Place callout below-right of target, with fallbacks if it goes off-screen
box_x = min(target_x + 20, w - box_w - 10)
box_y = min(target_y + 30, h - box_h - 10)
if box_x < 10:
    box_x = 10
if box_y < 10:
    box_y = 10

# Draw semi-transparent background
box_color = (88, 28, 135, 230)  # Purple, semi-transparent
draw.rounded_rectangle(
    [box_x, box_y, box_x + box_w, box_y + box_h],
    radius=12,
    fill=box_color,
)

# Draw text
text_x = box_x + padding
text_y = box_y + padding
for line in lines:
    draw.text((text_x, text_y), line, fill=(255, 255, 255), font=font)
    text_y += line_height

# Draw a small circle at the target point (hotspot indicator)
if ${target ? 'True' : 'False'}:
    circle_r = 12
    draw.ellipse(
        [target_x - circle_r, target_y - circle_r,
         target_x + circle_r, target_y + circle_r],
        fill=(88, 28, 135, 200),
        outline=(255, 255, 255, 255),
        width=3,
    )

img.save("${outputPath}")
`;

  await execFileAsync('python3', ['-c', pythonScript], { timeout: 15_000 });

  if (!existsSync(outputPath)) {
    throw new Error(`Annotated image not produced: ${outputPath}`);
  }
}

/**
 * Annotate all screenshots with callouts.
 * For each frame: use Claude vision to find the click target, then draw a callout.
 */
export interface AnnotationResult {
  readonly paths: string[];
  readonly coords: (ClickTarget | null)[];
}

export async function annotateScreenshots(
  framePaths: readonly string[],
  callouts: readonly string[],
  actionDescriptions: readonly string[],
): Promise<AnnotationResult> {
  const annotatedPaths: string[] = [];
  const coords: (ClickTarget | null)[] = [];

  logger.info('Annotating screenshots with callouts...', { count: framePaths.length });

  for (let i = 0; i < framePaths.length; i++) {
    const framePath = framePaths[i];
    const callout = i < callouts.length ? callouts[i] : '';
    const action = i < actionDescriptions.length ? actionDescriptions[i] : '';
    const outputPath = framePath.replace('.png', '.annotated.png');

    try {
      // Find click target using Claude vision
      const target = await findClickTarget(framePath, action);
      coords.push(target);
      if (target) {
        logger.info('Click target found', { step: i + 1, x: target.x, y: target.y });
      }

      // Draw callout onto screenshot
      await drawCallout(framePath, outputPath, target, callout);
      annotatedPaths.push(outputPath);

      if ((i + 1) % 5 === 0 || i === 0) {
        logger.info('Screenshots annotated', { step: i + 1, total: framePaths.length });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to annotate screenshot, using original', { step: i + 1, error: msg });
      annotatedPaths.push(framePath);
      coords.push(null);
    }
  }

  logger.info('Annotation complete', { annotated: annotatedPaths.length });
  return { paths: annotatedPaths, coords };
}
