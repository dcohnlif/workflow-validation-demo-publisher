/**
 * Create an MP4 slideshow video from a list of PNG screenshots.
 * Each screenshot is shown for a configurable duration.
 * This produces a video suitable for Arcade's "Video to Interactive Demo" feature,
 * where Avery AI can detect each frame change as a distinct step.
 */
import { execFile } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import * as logger from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Create an MP4 slideshow from a list of image files.
 * @param framePaths - Ordered list of PNG file paths
 * @param outputPath - Where to save the MP4
 * @param secondsPerFrame - How long each frame is shown (default 3s)
 */
export async function createSlideshow(
  framePaths: readonly string[],
  outputPath: string,
  secondsPerFrame = 3,
): Promise<string> {
  if (framePaths.length === 0) {
    throw new Error('No frames provided for slideshow');
  }

  // Create a concat file listing each frame with its duration
  const concatFile = join(dirname(outputPath), '.slideshow-concat.txt');
  const concatContent = framePaths
    .map((p) => `file '${p}'\nduration ${secondsPerFrame}`)
    .join('\n');
  // Add the last frame again (ffmpeg concat demuxer quirk -- last duration is ignored)
  const fullContent = concatContent + `\nfile '${framePaths[framePaths.length - 1]}'`;
  writeFileSync(concatFile, fullContent);

  try {
    await execFileAsync('ffmpeg', [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-c:v', 'libopenh264',
      '-pix_fmt', 'yuv420p',
      '-r', '25',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], { timeout: 300_000 });

    if (!existsSync(outputPath)) {
      throw new Error('Slideshow video was not produced');
    }

    const totalDuration = framePaths.length * secondsPerFrame;
    logger.info('Slideshow created', {
      frames: framePaths.length,
      duration: `${totalDuration}s`,
      output: outputPath,
    });

    return outputPath;
  } finally {
    // Clean up concat file
    try { unlinkSync(concatFile); } catch { /* ignore */ }
  }
}
