/**
 * Publish a demo by uploading individual screenshots as steps via Arcade's editor UI.
 * Each screenshot (extracted from video at action timestamps) becomes a step.
 * This uses Playwright to automate the "Start from scratch" -> "My computer" flow.
 */
import { existsSync, readdirSync, unlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as logger from '../util/logger.js';
import { extractClickFrames } from '../util/frames.js';
import type { DemoAction } from '../types.js';
import type { ArcadeAuth } from './auth.js';

const ARCADE_URL = 'https://app.arcade.software';

export interface ScreenshotsDemoResult {
  readonly flowId: string;
  readonly editUrl: string;
  readonly title: string;
  readonly steps: number;
}

export async function screenshotsToDemo(
  auth: ArcadeAuth,
  videoPath: string,
  actions: readonly DemoAction[],
  title: string,
  options: { storageStatePath?: string } = {},
): Promise<ScreenshotsDemoResult> {
  // Step 1: Filter to click actions only (these are the meaningful steps)
  const clickActions = actions.filter((a) => a.type === 'click');
  if (clickActions.length === 0) {
    throw new Error('No click actions found -- nothing to publish');
  }

  const clicks = clickActions.map((a, i) => ({
    id: `step-${String(i + 1).padStart(3, '0')}`,
    timestamp: a.timestamp,
  }));

  // Step 2: Extract and crop frames
  const framesDir = join(dirname(videoPath), '.arcade-frames');
  const frames = await extractClickFrames(videoPath, clicks, dirname(videoPath));

  // Collect frame paths in order
  const framePaths: string[] = [];
  for (const click of clicks) {
    const path = frames.get(click.id);
    if (path) framePaths.push(path);
  }

  if (framePaths.length === 0) {
    throw new Error('No frames extracted from video');
  }

  logger.info('Frames ready for upload', { count: framePaths.length });

  // Step 3: Launch Playwright and upload screenshots
  const pw = await import('playwright');
  const browser = await pw.chromium.launch({ headless: true, channel: 'chrome' });

  try {
    // Use storageState if available (includes cookies + localStorage -- more reliable)
    // Fall back to manual cookie injection
    const contextOptions = options.storageStatePath && existsSync(options.storageStatePath)
      ? { storageState: options.storageStatePath }
      : {};
    const context = await browser.newContext(contextOptions);

    if (!options.storageStatePath || !existsSync(options.storageStatePath)) {
      // Manual cookie injection fallback
      const cookies = auth.cookie.split('; ').map((pair) => {
        const eqIdx = pair.indexOf('=');
        return {
          name: pair.slice(0, eqIdx),
          value: pair.slice(eqIdx + 1),
          domain: '.arcade.software',
          path: '/',
          secure: true,
          sameSite: 'Strict' as const,
          httpOnly: true,
        };
      });
      await context.addCookies(cookies);
    }

    const page = await context.newPage();

    // Navigate to Arcade
    logger.info('Opening Arcade...');
    await page.goto(ARCADE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(5000);

    // If we landed on /workspaces (workspace picker), click through to the workspace
    let currentUrl = page.url();
    logger.info('Landed on', { url: currentUrl });

    if (currentUrl.includes('/auth')) {
      throw new Error('Arcade session expired. Save fresh storage state from browser.');
    }

    // Wait for the home page with New Demo button
    if (!currentUrl.includes('/home')) {
      await page.waitForURL('**/home', { timeout: 15_000 }).catch(() => {
        // May already be on home, just continue
      });
      currentUrl = page.url();
      logger.info('Navigated to', { url: currentUrl });
    }

    // Click "New Demo" -> "Start from scratch"
    logger.info('Creating new demo from screenshots...');
    const newDemoButton = page.locator('button:has-text("New Demo")');
    await newDemoButton.waitFor({ state: 'visible', timeout: 15_000 });
    await newDemoButton.click();
    await page.waitForTimeout(2000);

    const scratchOption = page.locator('text="Start from scratch"');
    await scratchOption.waitFor({ state: 'visible', timeout: 10_000 });
    await scratchOption.click();
    await page.waitForTimeout(2000);

    // Should now be in the editor with an empty step
    await page.waitForURL('**/flows/*/edit', { timeout: 30_000 });
    const editUrl = page.url();
    const flowIdMatch = editUrl.match(/\/flows\/([^/]+)\/edit/);
    if (!flowIdMatch) {
      throw new Error(`Could not extract flow ID from: ${editUrl}`);
    }
    const flowId = flowIdMatch[1];
    logger.info('Demo created', { flowId });

    // Upload first screenshot via "My computer" in the empty step
    logger.info('Uploading first screenshot...');
    const myComputerButton = page.locator('text="My computer"');
    await myComputerButton.waitFor({ state: 'visible', timeout: 10_000 });
    const firstChooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 });
    await myComputerButton.click();
    const firstChooser = await firstChooserPromise;
    await firstChooser.setFiles(framePaths[0]);
    await page.waitForTimeout(3000);
    logger.info('First screenshot uploaded', { step: 1 });

    // Upload remaining screenshots via "Add step" -> "My computer"
    if (framePaths.length > 1) {
      const remainingPaths = framePaths.slice(1);
      logger.info('Uploading remaining screenshots...', { count: remainingPaths.length });

      // Upload in batches to avoid overwhelming the UI
      const batchSize = 10;
      for (let i = 0; i < remainingPaths.length; i += batchSize) {
        const batch = remainingPaths.slice(i, i + batchSize);

        // Click the "+" button to add a step (either the "Add step" button or a "+" icon)
        const addButton = page.locator('button:has-text("Add step"), button:has-text("+")').first();
        await addButton.waitFor({ state: 'visible', timeout: 10_000 });
        await addButton.click();
        await page.waitForTimeout(1500);

        // Click "My computer" in the dropdown/popover
        const mcOption = page.locator('text="My computer"').last();
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 });
        await mcOption.click();
        const chooser = await chooserPromise;

        // Upload batch (multi-file upload creates one step per file)
        await chooser.setFiles(batch);
        await page.waitForTimeout(3000 + batch.length * 500);

        logger.info('Batch uploaded', {
          batch: Math.floor(i / batchSize) + 1,
          steps: `${i + 2}-${i + 1 + batch.length}`,
          total: framePaths.length,
        });
      }
    }

    // Add callouts to each step using the action labels
    logger.info('Adding callouts to steps...');
    const { toImperativeLabel } = await import('../transform/labels.js');

    for (let i = 0; i < Math.min(framePaths.length, clickActions.length); i++) {
      try {
        const stepNum = i + 1;

        // Navigate to the step by clicking its number badge in the thumbnail list
        // The thumbnails have the step number as text content
        const allStepBadges = page.locator(`text="${stepNum}"`);
        const count = await allStepBadges.count();

        // Find the one that's a small badge (in the thumbnail area, not in content)
        let clicked = false;
        for (let j = 0; j < count; j++) {
          const badge = allStepBadges.nth(j);
          const box = await badge.boundingBox();
          if (box && box.x < 230 && box.width < 40) {
            // This is in the sidebar area (left side, small element)
            await badge.click();
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          logger.warn('Could not find step thumbnail', { step: stepNum });
          continue;
        }
        await page.waitForTimeout(1000);

        // Click the "Callout" toolbar button (identified by aria-label)
        const calloutBtn = page.locator('button[aria-label="Callout"]');
        if (!(await calloutBtn.isVisible({ timeout: 3000 }))) {
          logger.warn('Callout button not visible', { step: stepNum });
          continue;
        }
        await calloutBtn.click();
        await page.waitForTimeout(1000);

        // Type the callout text
        const labelText = toImperativeLabel(clickActions[i].rawNarrative);
        await page.keyboard.type(labelText);
        await page.waitForTimeout(300);

        // Press Escape to deselect the callout
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        if (stepNum % 5 === 0 || stepNum === 1) {
          logger.info('Callout added', { step: stepNum, label: labelText.slice(0, 50) });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Failed to add callout', { step: i + 1, error: msg });
      }
    }
    logger.info('Callouts complete');

    // Set the title
    logger.info('Setting demo title...');
    try {
      const titleElement = page.locator(`text="Untitled"`).first();
      if (await titleElement.isVisible({ timeout: 3000 })) {
        await titleElement.dblclick();
        await page.waitForTimeout(500);
        await page.keyboard.press('Control+A');
        await page.keyboard.type(title);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
        logger.info('Title set', { title });
      }
    } catch {
      logger.warn('Could not set title automatically -- set it manually in the editor');
    }

    const finalEditUrl = `${ARCADE_URL}/flows/${flowId}/edit`;

    logger.info('Demo published', {
      flowId,
      editUrl: finalEditUrl,
      steps: framePaths.length,
    });

    return {
      flowId,
      editUrl: finalEditUrl,
      title,
      steps: framePaths.length,
    };
  } finally {
    await browser.close();

    // Clean up extracted frames
    if (existsSync(framesDir)) {
      try { rmSync(framesDir, { recursive: true }); } catch { /* ignore */ }
    }
  }
}
