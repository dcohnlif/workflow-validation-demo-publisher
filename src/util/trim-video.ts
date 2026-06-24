/**
 * Trim a video to keep only the interesting segments around user actions.
 * Removes long idle periods (page loads, spinners, API waits) and produces
 * a tight-cut video suitable for demo publishing.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { promisify } from 'node:util';
import * as logger from './logger.js';
import type { DemoAction } from '../types.js';

const execFileAsync = promisify(execFile);

/** Seconds of padding before the first action and after the last */
const PAD_BEFORE = 1.0;
const PAD_AFTER = 2.0;

/** Maximum gap (seconds) between actions before we cut the idle time */
const MAX_GAP = 3.0;

/** Minimum segment duration (seconds) to avoid micro-segments */
const MIN_SEGMENT = 1.0;

interface Segment {
  start: number;
  end: number;
}

/**
 * Compute interesting segments from action timestamps.
 * Groups actions that are close together into segments, cutting out
 * long gaps between them.
 */
export function computeSegments(
  actions: readonly DemoAction[],
  videoDuration?: number,
): Segment[] {
  // Filter to interactive actions only (clicks, types, keypresses)
  const interactive = actions.filter((a) =>
    ['click', 'type', 'keypress', 'scroll'].includes(a.type),
  );

  if (interactive.length === 0) return [];

  const segments: Segment[] = [];
  let segStart = Math.max(0, interactive[0].timestamp - PAD_BEFORE);
  let segEnd = interactive[0].timestamp + PAD_AFTER;

  for (let i = 1; i < interactive.length; i++) {
    const actionTime = interactive[i].timestamp;
    const gap = actionTime - segEnd;

    if (gap <= MAX_GAP) {
      // Action is close to previous -- extend current segment
      segEnd = actionTime + PAD_AFTER;
    } else {
      // Gap is too large -- save current segment and start a new one
      if (segEnd - segStart >= MIN_SEGMENT) {
        segments.push({ start: segStart, end: segEnd });
      }
      segStart = Math.max(0, actionTime - PAD_BEFORE);
      segEnd = actionTime + PAD_AFTER;
    }
  }

  // Don't forget the last segment
  if (segEnd - segStart >= MIN_SEGMENT) {
    segments.push({ start: segStart, end: segEnd });
  }

  // Cap the last segment at video duration if known
  if (videoDuration && segments.length > 0) {
    segments[segments.length - 1].end = Math.min(
      segments[segments.length - 1].end,
      videoDuration,
    );
  }

  return segments;
}

/**
 * Trim a video file to keep only the interesting segments.
 * Uses ffmpeg's concat filter to stitch segments together.
 *
 * @returns Path to the trimmed video file.
 */
export async function trimVideo(
  inputPath: string,
  actions: readonly DemoAction[],
  outputDir?: string,
): Promise<string> {
  const segments = computeSegments(actions);

  if (segments.length === 0) {
    logger.warn('No interactive actions found, returning original video');
    return inputPath;
  }

  const dir = outputDir ?? dirname(inputPath);
  const name = basename(inputPath, '.webm');
  const outputPath = join(dir, `${name}.trimmed.mp4`);

  const totalOriginal = actions.length > 0
    ? actions[actions.length - 1].timestamp
    : 0;
  const totalTrimmed = segments.reduce((sum, s) => sum + (s.end - s.start), 0);

  logger.info('Trimming video', {
    segments: segments.length,
    originalDuration: `${Math.round(totalOriginal)}s`,
    trimmedDuration: `${Math.round(totalTrimmed)}s`,
    reduction: `${Math.round((1 - totalTrimmed / Math.max(totalOriginal, 1)) * 100)}%`,
  });

  if (segments.length === 1) {
    // Single segment -- simple trim
    const seg = segments[0];
    await execFileAsync('ffmpeg', [
      '-ss', String(seg.start),
      '-to', String(seg.end),
      '-i', inputPath,
      '-c:v', 'libopenh264',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], { timeout: 300_000 });
  } else {
    // Multiple segments -- use ffmpeg concat filter
    // Create a filter complex that trims and concatenates
    const filterParts: string[] = [];
    const concatInputs: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      filterParts.push(
        `[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`,
      );
      concatInputs.push(`[v${i}]`);
    }

    const filterComplex = [
      ...filterParts,
      `${concatInputs.join('')}concat=n=${segments.length}:v=1:a=0[outv]`,
    ].join(';');

    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-c:v', 'libopenh264',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], { timeout: 300_000 });
  }

  if (!existsSync(outputPath)) {
    throw new Error('Trimmed video was not produced');
  }

  logger.info('Video trimmed', { output: outputPath });
  return outputPath;
}
