/**
 * Publish a demo using Arcade's "Video to Interactive Demo" feature via Playwright.
 * This automates the web UI flow: upload MP4 -> Avery AI processes -> interactive demo.
 */
import { execFile } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { promisify } from 'node:util';
import * as logger from '../util/logger.js';
import type { ArcadeAuth } from './auth.js';

const execFileAsync = promisify(execFile);

const ARCADE_URL = 'https://app.arcade.software';

export interface VideoToDemoResult {
  readonly flowId: string;
  readonly editUrl: string;
  readonly title: string;
}

async function convertToMp4(webmPath: string): Promise<string> {
  const mp4Path = webmPath.replace(/\.webm$/, '.tmp.mp4');

  logger.info('Converting video to MP4...', { input: webmPath });

  await execFileAsync('ffmpeg', [
    '-i', webmPath,
    '-c:v', 'libopenh264',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    '-y',
    mp4Path,
  ], { timeout: 300_000 });

  logger.info('Video converted', { output: mp4Path });
  return mp4Path;
}

function buildCookieList(cookieStr: string): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
}> {
  return cookieStr.split('; ').map((pair) => {
    const eqIdx = pair.indexOf('=');
    const name = pair.slice(0, eqIdx);
    const value = pair.slice(eqIdx + 1);
    return { name, value, domain: '.arcade.software', path: '/' };
  });
}

export async function videoToDemo(
  auth: ArcadeAuth,
  videoPath: string,
  options: { cleanupMp4?: boolean } = {},
): Promise<VideoToDemoResult> {
  // Step 1: Convert to MP4 if needed
  let mp4Path = videoPath;
  let needsCleanup = false;

  if (videoPath.endsWith('.webm')) {
    mp4Path = await convertToMp4(videoPath);
    needsCleanup = options.cleanupMp4 !== false;
  } else if (!videoPath.endsWith('.mp4')) {
    throw new Error(`Unsupported video format: ${videoPath}. Use .webm or .mp4`);
  }

  if (!existsSync(mp4Path)) {
    throw new Error(`Video file not found: ${mp4Path}`);
  }

  // Step 2: Launch Playwright
  // Dynamic import to avoid hard dependency for users who only use dry-run/API mode
  const pw = await import('playwright');
  const browser = await pw.chromium.launch({ headless: true, channel: 'chrome' });

  try {
    const context = await browser.newContext();

    // Set cookies
    const cookies = buildCookieList(auth.cookie);
    await context.addCookies(cookies);

    const page = await context.newPage();

    // Step 3: Navigate to Arcade home
    logger.info('Opening Arcade...');
    await page.goto(ARCADE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const url = page.url();
    logger.info('Landed on', { url });

    if (url.includes('/auth')) {
      throw new Error('Arcade session expired. Run scripts/get-arcade-cookie.sh to refresh.');
    }

    // Step 4: Click "New Demo" -> "Video to Interactive Demo"
    logger.info('Creating new Video to Interactive Demo...');

    // Wait for the button to appear
    const newDemoButton = page.locator('button:has-text("New Demo")');
    await newDemoButton.waitFor({ state: 'visible', timeout: 15_000 });
    await newDemoButton.click();
    await page.waitForTimeout(2000);

    const videoOption = page.locator('text="Video to Interactive Demo"');
    await videoOption.waitFor({ state: 'visible', timeout: 10_000 });

    // Set up file chooser listener BEFORE clicking (the click triggers it)
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 });
    await videoOption.click();

    // Step 5: Upload the MP4 via file picker
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(mp4Path);

    logger.info('Video uploaded, waiting for Avery to process...', { file: mp4Path });

    // Step 6: Wait for redirect to the editor (means processing started)
    await page.waitForURL('**/flows/*/edit', { timeout: 60_000 });
    const editUrl = page.url();

    // Extract flow ID from URL: /flows/{flowId}/edit
    const flowIdMatch = editUrl.match(/\/flows\/([^/]+)\/edit/);
    if (!flowIdMatch) {
      throw new Error(`Could not extract flow ID from URL: ${editUrl}`);
    }
    const flowId = flowIdMatch[1];

    // Wait for Avery to finish processing (title changes from "Untitled" to something meaningful)
    logger.info('Waiting for Avery AI processing...', { flowId });
    let title = 'Untitled';
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      title = await page.title();
      if (title.startsWith('Edit: ') && !title.includes('Untitled')) {
        title = title.replace('Edit: ', '');
        break;
      }
    }

    if (title.includes('Untitled')) {
      // Avery didn't generate a title, but the demo was still created
      logger.warn('Avery did not generate a title (demo may still be processing)');
      title = 'Untitled';
    }

    logger.info('Demo created', { flowId, editUrl, title });

    return { flowId, editUrl, title };
  } finally {
    await browser.close();

    // Clean up temp MP4
    if (needsCleanup && existsSync(mp4Path)) {
      try {
        unlinkSync(mp4Path);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
