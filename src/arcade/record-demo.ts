/**
 * Create an Arcade demo by replaying annotated screenshots as a live recording.
 * 
 * Instead of uploading static images or synthetic slideshows, this approach:
 * 1. Serves each annotated screenshot as a full-screen HTML page
 * 2. Opens it in a Playwright browser with video recording enabled
 * 3. Navigates between pages, clicking at the coordinates Claude vision identified
 * 4. The result is a real screen recording with genuine mouse movements and clicks
 * 5. Uploads the recording via "Video to Interactive Demo" -- Avery detects real clicks
 * 
 * This produces proper interactive demos because Avery sees actual user behavior.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import * as logger from '../util/logger.js';
import { extractClickFrames } from '../util/frames.js';
import { annotateScreenshots } from '../transform/annotate.js';
import { videoToDemo } from './video-to-demo.js';
import type { DemoAction } from '../types.js';
import type { ArcadeAuth } from './auth.js';

export interface RecordDemoResult {
  readonly flowId: string;
  readonly editUrl: string;
  readonly title: string;
  readonly steps: number;
}

interface ClickCoord {
  x: number;
  y: number;
}

/**
 * Start a minimal HTTP server that serves screenshots as full-screen HTML pages.
 */
function startImageServer(
  framePaths: readonly string[],
  port: number,
): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    const url = req.url ?? '/';

    // Serve the image file directly
    if (url.startsWith('/img/')) {
      const idx = parseInt(url.slice(5), 10);
      if (idx >= 0 && idx < framePaths.length && existsSync(framePaths[idx])) {
        const data = readFileSync(framePaths[idx]);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(data);
        return;
      }
    }

    // Serve an HTML page that displays a screenshot full-screen
    const match = url.match(/^\/step\/(\d+)/);
    if (match) {
      const idx = parseInt(match[1], 10);
      const total = framePaths.length;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html><head>
<style>
  * { margin: 0; padding: 0; }
  body { background: #f5f5f5; overflow: hidden; cursor: default; }
  img { width: 100vw; height: 100vh; object-fit: contain; display: block; }
</style>
<title>Step ${idx + 1} of ${total}</title>
</head><body>
<img src="/img/${idx}" />
</body></html>`);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port);
  return server;
}

export async function recordDemo(
  auth: ArcadeAuth,
  videoPath: string,
  actions: readonly DemoAction[],
  title: string,
  clickCoords: readonly (ClickCoord | null)[],
  options: {
    storageStatePath?: string;
    callouts?: readonly string[];
  } = {},
): Promise<RecordDemoResult> {
  const clickActions = actions.filter((a) => a.type === 'click');
  if (clickActions.length === 0) throw new Error('No click actions');

  // Step 1: Extract, crop, and annotate frames
  const clicks = clickActions.map((a, i) => ({
    id: `step-${String(i + 1).padStart(3, '0')}`,
    timestamp: a.timestamp,
  }));

  const frames = await extractClickFrames(videoPath, clicks, dirname(videoPath));
  const framePaths: string[] = [];
  for (const click of clicks) {
    const p = frames.get(click.id);
    if (p) framePaths.push(p);
  }

  if (framePaths.length === 0) throw new Error('No frames extracted');

  let displayPaths = framePaths;
  const resolvedCoords: (ClickCoord | null)[] = [...clickCoords];
  if (options.callouts && options.callouts.length > 0) {
    const descriptions = clickActions.map((a) => a.rawNarrative);
    const annotResult = await annotateScreenshots(framePaths, options.callouts, descriptions);
    displayPaths = annotResult.paths;
    // Use vision-detected coords for click replay
    if (resolvedCoords.length === 0) {
      resolvedCoords.push(...annotResult.coords);
    }
  }

  // Step 2: Start local image server
  const port = 18932;
  const server = startImageServer(displayPaths, port);
  const framesDir = join(dirname(videoPath), '.arcade-frames');
  const recordingDir = join(dirname(videoPath), '.arcade-recording');

  try {
    // Step 3: Launch Playwright with video recording
    const pw = await import('playwright');
    const browser = await pw.chromium.launch({ headless: true, channel: 'chrome' });
    const context = await browser.newContext({
      viewport: { width: 1388, height: 1080 },
      recordVideo: {
        dir: recordingDir,
        size: { width: 1388, height: 1080 },
      },
    });

    const page = await context.newPage();

    // Step 4: Navigate between screenshots and click at identified coordinates
    logger.info('Recording demo...', { steps: displayPaths.length });

    for (let i = 0; i < displayPaths.length; i++) {
      await page.goto(`http://localhost:${port}/step/${i}`, {
        waitUntil: 'load',
        timeout: 10_000,
      });

      // Wait for the image to render and give Avery time to see this as a distinct frame
      await page.waitForTimeout(2500);

      // Click at the identified coordinate (or center if unknown)
      const coord = i < resolvedCoords.length ? resolvedCoords[i] : null;
      const clickX = coord?.x ?? 694;
      const clickY = coord?.y ?? 540;

      // Smooth mouse movement to the click target (makes click detection easier for Avery)
      await page.mouse.move(clickX, clickY, { steps: 15 });
      await page.waitForTimeout(500);
      await page.mouse.click(clickX, clickY);
      // Pause after click so Avery sees the distinct pre/post click state
      await page.waitForTimeout(2000);

      if ((i + 1) % 5 === 0 || i === 0) {
        logger.info('Step recorded', { step: i + 1, total: displayPaths.length, x: clickX, y: clickY });
      }
    }

    // Final pause
    await page.waitForTimeout(2000);

    // Close context to finalize the video
    await context.close();
    await browser.close();

    // Find the recorded video
    const { readdirSync } = await import('node:fs');
    const recordings = readdirSync(recordingDir).filter((f) => f.endsWith('.webm'));
    if (recordings.length === 0) throw new Error('No recording produced');

    const recordedVideoPath = join(recordingDir, recordings[0]);
    logger.info('Recording complete', { path: recordedVideoPath });

    // Step 5: Upload via "Video to Interactive Demo"
    const result = await videoToDemo(auth, recordedVideoPath, {
      cleanupMp4: true,
      storageStatePath: options.storageStatePath,
    });

    return {
      flowId: result.flowId,
      editUrl: result.editUrl,
      title: result.title || title,
      steps: displayPaths.length,
    };
  } finally {
    server.close();
    if (existsSync(framesDir)) {
      try { rmSync(framesDir, { recursive: true }); } catch { /* ignore */ }
    }
    if (existsSync(recordingDir)) {
      try { rmSync(recordingDir, { recursive: true }); } catch { /* ignore */ }
    }
  }
}
