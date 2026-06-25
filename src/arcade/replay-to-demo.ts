/**
 * Create an interactive demo by replaying clicks on screenshots in a real browser.
 * 
 * Instead of trying to trick Avery with slideshows, this approach:
 * 1. Opens each annotated screenshot as a full-screen page in Playwright
 * 2. Installs the Arcade Chrome extension
 * 3. Records a real Chrome extension session by navigating between screenshots
 *    and clicking at the coordinates Claude vision identified
 * 
 * ...actually, the Chrome extension approach is too complex.
 * 
 * SIMPLER: Use the Arcade editor's Hotspot tool to add a click-to-advance
 * target on each screenshot step. The hotspot is just a clickable circle --
 * no text editing needed (our callouts are baked into the images).
 */
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as logger from '../util/logger.js';
import { extractClickFrames } from '../util/frames.js';
import { annotateScreenshots } from '../transform/annotate.js';
import type { DemoAction } from '../types.js';
import type { ArcadeAuth } from './auth.js';

const ARCADE_URL = 'https://app.arcade.software';

export interface ReplayDemoResult {
  readonly flowId: string;
  readonly editUrl: string;
  readonly title: string;
  readonly steps: number;
}

export async function replayToDemo(
  auth: ArcadeAuth,
  videoPath: string,
  actions: readonly DemoAction[],
  title: string,
  options: {
    storageStatePath?: string;
    callouts?: readonly string[];
  } = {},
): Promise<ReplayDemoResult> {
  const clickActions = actions.filter((a) => a.type === 'click');
  if (clickActions.length === 0) {
    throw new Error('No click actions found');
  }

  // Step 1: Extract and crop frames
  const clicks = clickActions.map((a, i) => ({
    id: `step-${String(i + 1).padStart(3, '0')}`,
    timestamp: a.timestamp,
  }));

  const frames = await extractClickFrames(videoPath, clicks, dirname(videoPath));
  const framePaths: string[] = [];
  for (const click of clicks) {
    const path = frames.get(click.id);
    if (path) framePaths.push(path);
  }

  if (framePaths.length === 0) {
    throw new Error('No frames extracted');
  }

  // Step 2: Annotate with callouts if provided
  let uploadPaths = framePaths;
  if (options.callouts && options.callouts.length > 0) {
    const descriptions = clickActions.map((a) => a.rawNarrative);
    const annotResult = await annotateScreenshots(framePaths, options.callouts, descriptions); uploadPaths = annotResult.paths;
  }

  // Step 3: Launch Playwright
  const pw = await import('playwright');
  const browser = await pw.chromium.launch({ headless: true, channel: 'chrome' });
  const framesDir = join(dirname(videoPath), '.arcade-frames');

  try {
    const contextOptions = options.storageStatePath && existsSync(options.storageStatePath)
      ? { storageState: options.storageStatePath }
      : {};
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // Navigate to Arcade
    logger.info('Opening Arcade...');
    await page.goto(ARCADE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(5000);

    if (page.url().includes('/auth')) {
      throw new Error('Session expired. Save fresh storage state.');
    }

    // Create demo via "Start from scratch"
    logger.info('Creating demo...');
    const newDemoBtn = page.locator('button:has-text("New Demo")');
    await newDemoBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await newDemoBtn.click();
    await page.waitForTimeout(2000);

    await page.locator('text="Start from scratch"').click();
    await page.waitForTimeout(2000);

    await page.waitForURL('**/flows/*/edit', { timeout: 30_000 });
    const flowIdMatch = page.url().match(/\/flows\/([^/]+)\/edit/);
    if (!flowIdMatch) throw new Error('Could not get flow ID');
    const flowId = flowIdMatch[1];
    logger.info('Demo created', { flowId });

    // Upload first screenshot
    logger.info('Uploading first screenshot...');
    const mcBtn = page.locator('text="My computer"');
    await mcBtn.waitFor({ state: 'visible', timeout: 10_000 });
    const fc1 = page.waitForEvent('filechooser', { timeout: 10_000 });
    await mcBtn.click();
    const chooser1 = await fc1;
    await chooser1.setFiles(uploadPaths[0]);
    await page.waitForTimeout(3000);

    // Add hotspot to first step (makes it interactive)
    await addHotspot(page, 1);

    // Upload and add hotspot to remaining steps
    for (let i = 1; i < uploadPaths.length; i++) {
      // Add step
      const addBtn = page.locator('button:has-text("Add step"), button:has-text("+")').first();
      await addBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await addBtn.click();
      await page.waitForTimeout(1000);

      const mcOption = page.locator('text="My computer"').last();
      const fcPromise = page.waitForEvent('filechooser', { timeout: 10_000 });
      await mcOption.click();
      const fc = await fcPromise;
      await fc.setFiles(uploadPaths[i]);
      await page.waitForTimeout(2000);

      // Add hotspot
      await addHotspot(page, i + 1);

      if ((i + 1) % 5 === 0) {
        logger.info('Steps uploaded', { step: i + 1, total: uploadPaths.length });
      }
    }

    const editUrl = `${ARCADE_URL}/flows/${flowId}/edit`;
    logger.info('Demo published', { flowId, editUrl, steps: uploadPaths.length });

    return { flowId, editUrl, title, steps: uploadPaths.length };
  } finally {
    await browser.close();
    if (existsSync(framesDir)) {
      try { rmSync(framesDir, { recursive: true }); } catch { /* ignore */ }
    }
  }
}

/**
 * Add a hotspot to the currently visible step.
 * A hotspot is just a clickable circle -- makes the step interactive.
 */
async function addHotspot(
  page: import('playwright').Page,
  stepNum: number,
): Promise<void> {
  try {
    const hotspotBtn = page.locator('button[aria-label="Hotspot"]');
    if (await hotspotBtn.isVisible({ timeout: 2000 })) {
      await hotspotBtn.click();
      await page.waitForTimeout(800);
      // Click somewhere on the stage to place the hotspot
      // (it appears at the click position)
      const stage = page.locator('main').first();
      const box = await stage.boundingBox();
      if (box) {
        // Click center of the stage area
        await stage.click({ position: { x: box.width / 2, y: box.height / 2 } });
        await page.waitForTimeout(500);
      }
      // Press Escape to deselect
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      logger.info('Hotspot added', { step: stepNum });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Could not add hotspot', { step: stepNum, error: msg });
  }
}
