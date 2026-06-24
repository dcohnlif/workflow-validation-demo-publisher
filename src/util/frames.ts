/**
 * Extract individual PNG frames from a video at specific timestamps using ffmpeg.
 * Supports auto-cropping grey bars from raw per-tab recordings.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as logger from './logger.js';
import { detectGreyBar } from './trim-video.js';

const execFileAsync = promisify(execFile);

/**
 * Extract a single frame from a video at the given timestamp.
 * Optionally crops the grey bar if crop dimensions are provided.
 * @returns Path to the extracted PNG file.
 */
export async function extractFrame(
  videoPath: string,
  timestampSeconds: number,
  outputDir: string,
  frameId: string,
  crop?: { width: number; height: number },
): Promise<string> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = join(outputDir, `${frameId}.png`);

  const args = [
    '-ss', String(timestampSeconds),
    '-i', videoPath,
    '-frames:v', '1',
  ];

  if (crop) {
    args.push('-vf', `crop=${crop.width}:${crop.height}:0:0`);
  }

  args.push('-q:v', '2', '-y', outputPath);

  await execFileAsync('ffmpeg', args, { timeout: 30_000 });

  // ffmpeg may exit 0 but produce no output if timestamp is beyond video duration
  if (!existsSync(outputPath)) {
    throw new Error(`Frame not produced (timestamp ${timestampSeconds}s may exceed video duration)`);
  }

  return outputPath;
}

/**
 * Extract frames for all click events, returning a map of clickId -> PNG path.
 * Auto-detects and crops grey bars from raw per-tab recordings.
 */
export async function extractClickFrames(
  videoPath: string,
  clicks: readonly { id: string; timestamp: number }[],
  outputDir: string,
): Promise<Map<string, string>> {
  const framesDir = join(outputDir, '.arcade-frames');
  const result = new Map<string, string>();

  // Detect grey bar once for all frames
  const crop = await detectGreyBar(videoPath);
  if (crop) {
    logger.info('Will crop grey bar from frames', { contentWidth: crop.width });
  }

  logger.info('Extracting frames from video', {
    videoPath,
    clicks: clicks.length,
    outputDir: framesDir,
  });

  for (const click of clicks) {
    try {
      const framePath = await extractFrame(videoPath, click.timestamp, framesDir, click.id, crop ?? undefined);
      result.set(click.id, framePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to extract frame', { clickId: click.id, timestamp: click.timestamp, error: message });
    }
  }

  logger.info('Frame extraction complete', {
    extracted: result.size,
    total: clicks.length,
  });

  return result;
}
