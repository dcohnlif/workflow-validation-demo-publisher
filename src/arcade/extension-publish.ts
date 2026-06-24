/**
 * Orchestrates publishing a workflow demo using Arcade's internal extension API.
 * Flow: demo-start -> extract frames -> upload screenshots -> upload video -> demo-end
 */
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import * as logger from '../util/logger.js';
import { extractClickFrames } from '../util/frames.js';
import type { DemoAction, ArcadeEvent } from '../types.js';
import type { ExtensionClient, CapturedEvent } from './extension-client.js';

interface PublishInput {
  readonly title: string;
  readonly description: string;
  readonly videoPath: string;
  readonly actions: readonly DemoAction[];
  readonly events: readonly ArcadeEvent[];
}

interface PublishOutput {
  readonly flowId: string;
  readonly editUrl: string;
  readonly steps: number;
}

function buildCapturedEvents(actions: readonly DemoAction[]): CapturedEvent[] {
  // Simulate wall-clock timestamps based on relative seconds
  const startMs = Date.now() - (actions.length > 0 ? actions[actions.length - 1].timestamp * 1000 : 0);

  return actions
    .filter((a) => ['click', 'type', 'keypress', 'scroll'].includes(a.type))
    .map((action) => {
      const timeMs = startMs + action.timestamp * 1000;
      const pageCtx = {
        url: action.page.url ?? '',
        title: action.page.title ?? '',
        description: '',
        width: 1920,
        height: 1080,
        language: 'en' as string | null,
      };

      if (action.type === 'click') {
        // Use center of viewport as default click position (normalized later)
        return {
          type: 'click' as const,
          clickId: randomUUID(),
          timeMs,
          tabId: 0,
          frameId: 0,
          frameX: 960,
          frameY: 540,
          pageContext: pageCtx,
        };
      }
      if (action.type === 'scroll') {
        return { type: 'scroll' as const, timeMs };
      }
      if (action.type === 'type') {
        return { type: 'input' as const, timeMs };
      }
      return { type: 'keypress' as const, timeMs };
    });
}

export async function extensionPublish(
  client: ExtensionClient,
  input: PublishInput,
): Promise<PublishOutput> {
  // Step 1: Start demo
  const flowId = await client.demoStart(input.title);

  try {
    // Step 2: Extract frames from video at click timestamps
    const clickActions = input.actions.filter((a) => a.type === 'click');
    const clicksForFrames = clickActions.map((a, i) => ({
      id: `click-${i}`,
      timestamp: a.timestamp,
    }));

    const frames = await extractClickFrames(
      input.videoPath,
      clicksForFrames,
      dirname(input.videoPath),
    );

    // Step 3: Upload screenshots and register image steps
    const screenshots: Record<string, { dataUrl: string; blurhash?: string; size?: { width: number; height: number } }> = {};
    const capturedEvents = buildCapturedEvents(input.actions);
    const clickEvents = capturedEvents.filter((e) => e.type === 'click');

    for (let i = 0; i < clickActions.length; i++) {
      const frameKey = `click-${i}`;
      const framePath = frames.get(frameKey);
      const clickEvent = clickEvents[i];
      const assetId = clickEvent?.clickId ?? frameKey;

      if (!framePath) {
        logger.warn('No frame for click, skipping screenshot upload', { index: i });
        screenshots[assetId] = { dataUrl: '' };
        continue;
      }

      // Upload screenshot
      const uploadInfo = await client.getUploadUrl(flowId, 'image');
      await client.uploadFile(uploadInfo.uploadUrl, uploadInfo.contentType, framePath);

      // Register the image step
      const action = clickActions[i];
      const stepResp = await client.registerImageStep({
        flowId,
        assetId,
        url: uploadInfo.publicUrl,
        useAI: false,
        hasHTML: false,
        pageContext: {
          url: action.page.url ?? '',
          title: action.page.title ?? '',
          description: '',
          width: 1920,
          height: 1080,
          language: 'en',
        },
      });

      screenshots[assetId] = {
        dataUrl: uploadInfo.publicUrl,
        blurhash: stepResp.blurhash,
        size: stepResp.size,
      };

      logger.info('Screenshot uploaded', { step: i + 1, total: clickActions.length, assetId });
    }

    // Step 4: Upload "final" screenshot (last frame -- extension does this before demo-end)
    if (clickActions.length > 0) {
      const lastFrameKey = `click-${clickActions.length - 1}`;
      const lastFramePath = frames.get(lastFrameKey);
      if (lastFramePath) {
        const finalUpload = await client.getUploadUrl(flowId, 'image');
        await client.uploadFile(finalUpload.uploadUrl, finalUpload.contentType, lastFramePath);
        const lastAction = clickActions[clickActions.length - 1];
        const finalResp = await client.registerImageStep({
          flowId,
          assetId: 'final',
          url: finalUpload.publicUrl,
          useAI: false,
          hasHTML: false,
          pageContext: {
            url: lastAction.page.url ?? '',
            title: lastAction.page.title ?? '',
            description: '',
            width: 1920,
            height: 1080,
            language: 'en',
          },
        });
        screenshots['final'] = {
          dataUrl: finalUpload.publicUrl,
          blurhash: finalResp.blurhash,
          size: finalResp.size,
        };
        logger.info('Final screenshot uploaded');
      }
    }

    // Step 5: Upload video
    logger.info('Uploading video...');
    const videoUpload = await client.getUploadUrl(flowId, 'video');
    await client.uploadFile(videoUpload.uploadUrl, videoUpload.contentType, input.videoPath);
    await client.createMuxAsset(videoUpload.publicUrl, flowId);
    logger.info('Video uploaded');

    // Step 6: Finalize demo
    const recordingDurationMs = input.actions.length > 0
      ? input.actions[input.actions.length - 1].timestamp * 1000
      : 0;

    const tabData = {
      tabId: 0,
      tabScreenX: 0,
      tabScreenY: 0,
      tabWidth: 1920,
      tabHeight: 1080,
      tabUrl: clickActions[0]?.page.url ?? '',
      frames: {
        0: {
          frameScreenX: 0,
          frameScreenY: 0,
          frameWidth: 1920,
          frameHeight: 1080,
        },
      },
    };

    await client.demoEnd({
      flowId,
      capturedEvents,
      screenshots,
      tabs: { 0: tabData },
      videoTimestampWindows: [[0, recordingDurationMs]],
      pageContexts: Object.fromEntries(
        clickEvents.map((e) => [e.clickId, e.pageContext]),
      ),
      clickContexts: {},
      capturedHTML: {},
      links: {},
      endedAt: Date.now(),
      useAI: false,
      hasHTML: false,
      videoBlobUrl: videoUpload.publicUrl,
    });

    const editUrl = `https://app.arcade.software/flows/${flowId}/edit`;

    logger.info('Demo published', {
      flowId,
      editUrl,
      steps: clickActions.length,
    });

    return { flowId, editUrl, steps: clickActions.length };
  } catch (err) {
    // Clean up on failure
    try {
      await client.demoStatus(flowId, 'error', err instanceof Error ? err.message : String(err));
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}
