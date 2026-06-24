/**
 * Extract individual PNG frames from a video at specific timestamps using ffmpeg.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as logger from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Extract a single frame from a video at the given timestamp.
 * @returns Path to the extracted PNG file.
 */
export async function extractFrame(
  videoPath: string,
  timestampSeconds: number,
  outputDir: string,
  frameId: string,
): Promise<string> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = join(outputDir, `${frameId}.png`);

  await execFileAsync('ffmpeg', [
    '-ss', String(timestampSeconds),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '2',
    '-y',
    outputPath,
  ], { timeout: 30_000 });

  // ffmpeg may exit 0 but produce no output if timestamp is beyond video duration
  if (!existsSync(outputPath)) {
    throw new Error(`Frame not produced (timestamp ${timestampSeconds}s may exceed video duration)`);
  }

  return outputPath;
}

/**
 * Extract frames for all click events, returning a map of clickId -> PNG path.
 */
export async function extractClickFrames(
  videoPath: string,
  clicks: readonly { id: string; timestamp: number }[],
  outputDir: string,
): Promise<Map<string, string>> {
  const framesDir = join(outputDir, '.arcade-frames');
  const result = new Map<string, string>();

  logger.info('Extracting frames from video', {
    videoPath,
    clicks: clicks.length,
    outputDir: framesDir,
  });

  for (const click of clicks) {
    try {
      const framePath = await extractFrame(videoPath, click.timestamp, framesDir, click.id);
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
