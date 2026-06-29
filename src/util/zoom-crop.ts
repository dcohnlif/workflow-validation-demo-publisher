/**
 * Crop screenshots to zoom into the action area around the click target.
 * Instead of showing the full 1920px page, show a focused region around
 * the UI element being interacted with, similar to how professional
 * Arcade demos use pan-and-zoom.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import * as logger from './logger.js';

const execFileAsync = promisify(execFile);

interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute a crop region centered on the click target.
 * The region is large enough to provide context but focused enough
 * to draw attention to the action area.
 */
function computeCropRegion(
  clickX: number,
  clickY: number,
  imgWidth: number,
  imgHeight: number,
  zoomWidth = 960,
  zoomHeight = 700,
): CropRegion {
  // Don't zoom if the image is already small
  if (imgWidth <= zoomWidth || imgHeight <= zoomHeight) {
    return { x: 0, y: 0, width: imgWidth, height: imgHeight };
  }

  // Center the crop on the click target
  let x = Math.round(clickX - zoomWidth / 2);
  let y = Math.round(clickY - zoomHeight / 2);

  // Clamp to image bounds
  x = Math.max(0, Math.min(x, imgWidth - zoomWidth));
  y = Math.max(0, Math.min(y, imgHeight - zoomHeight));

  return { x, y, width: zoomWidth, height: zoomHeight };
}

/**
 * Crop a screenshot to zoom into the action area using PIL.
 * Returns the path to the cropped image.
 */
export async function zoomCropScreenshot(
  inputPath: string,
  outputPath: string,
  clickX: number,
  clickY: number,
  zoomWidth = 960,
  zoomHeight = 700,
): Promise<void> {
  await execFileAsync('python3', ['-c', `
from PIL import Image

img = Image.open("${inputPath}")
w, h = img.size

# Compute crop region centered on click target
zw, zh = ${zoomWidth}, ${zoomHeight}
if w <= zw or h <= zh:
    img.save("${outputPath}")
else:
    cx = max(0, min(int(${clickX} - zw / 2), w - zw))
    cy = max(0, min(int(${clickY} - zh / 2), h - zh))
    cropped = img.crop((cx, cy, cx + zw, cy + zh))
    cropped.save("${outputPath}")
`], { timeout: 10_000 });

  if (!existsSync(outputPath)) {
    throw new Error(`Zoom crop failed: ${outputPath}`);
  }
}

/**
 * Apply zoom cropping to all screenshots based on their click coordinates.
 * Returns paths to the zoomed screenshots.
 */
export async function zoomCropScreenshots(
  framePaths: readonly string[],
  coords: readonly ({ x: number; y: number } | null)[],
  zoomWidth = 960,
  zoomHeight = 700,
): Promise<string[]> {
  const result: string[] = [];

  logger.info('Zooming into action areas...', { count: framePaths.length, zoomSize: `${zoomWidth}x${zoomHeight}` });

  for (let i = 0; i < framePaths.length; i++) {
    const coord = i < coords.length ? coords[i] : null;
    const inputPath = framePaths[i];
    const outputPath = inputPath.replace('.png', '.zoomed.png');

    if (coord) {
      try {
        await zoomCropScreenshot(inputPath, outputPath, coord.x, coord.y, zoomWidth, zoomHeight);
        result.push(outputPath);
      } catch {
        result.push(inputPath); // fallback to original
      }
    } else {
      // No click target -- use the original (full view)
      result.push(inputPath);
    }
  }

  logger.info('Zoom cropping complete', { zoomed: result.filter(p => p.includes('.zoomed.')).length });
  return result;
}
