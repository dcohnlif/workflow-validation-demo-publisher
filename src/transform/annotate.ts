/**
 * Use Claude vision to identify click targets in screenshots, then draw
 * callouts directly onto the images before uploading to Arcade.
 *
 * This bypasses the Arcade editor UI entirely -- callouts are baked into
 * the screenshots as visual overlays.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
 * Find click target coordinates in all screenshots using Claude vision.
 * Returns the original (unmodified) frame paths and detected coordinates.
 * No visual annotations are drawn -- Avery handles callout rendering.
 */
export interface AnnotationResult {
  readonly paths: string[];
  readonly coords: (ClickTarget | null)[];
}

export async function annotateScreenshots(
  framePaths: readonly string[],
  _callouts: readonly string[],
  actionDescriptions: readonly string[],
): Promise<AnnotationResult> {
  const coords: (ClickTarget | null)[] = [];

  logger.info('Detecting click targets in screenshots...', { count: framePaths.length });

  for (let i = 0; i < framePaths.length; i++) {
    const action = i < actionDescriptions.length ? actionDescriptions[i] : '';

    try {
      const target = await findClickTarget(framePaths[i], action);
      coords.push(target);
      if (target) {
        logger.info('Click target found', { step: i + 1, x: target.x, y: target.y });
      }

      if ((i + 1) % 5 === 0 || i === 0) {
        logger.info('Targets detected', { step: i + 1, total: framePaths.length });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to detect click target', { step: i + 1, error: msg });
      coords.push(null);
    }
  }

  logger.info('Detection complete', { detected: coords.filter(Boolean).length, total: framePaths.length });
  return { paths: [...framePaths], coords };
}
