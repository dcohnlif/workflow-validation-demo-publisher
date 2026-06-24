import { Command } from 'commander';
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseActionsFile } from './parsers/actions.js';
import { parseReportFile } from './parsers/report.js';
import { transformToArcadeEvents } from './transform/events.js';
import { toImperativeLabel } from './transform/labels.js';
import { ArcadeClient } from './arcade/client.js';
import { uploadWorkflowVideo } from './arcade/upload.js';
import { loadAuth } from './arcade/auth.js';
import { ExtensionClient } from './arcade/extension-client.js';
import { extensionPublish } from './arcade/extension-publish.js';
import { videoToDemo } from './arcade/video-to-demo.js';
import { screenshotsToDemo } from './arcade/screenshots-to-demo.js';
import { enhanceDemo } from './transform/enhance.js';
import * as logger from './util/logger.js';
import type { ArcadeConfig, PublishResult } from './types.js';

const ACTIONS_FILENAME = 'actions.md';
const ARCADE_APP_URL = 'https://app.arcade.software';

interface PublishOptions {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly dryRun: boolean;
  readonly output?: string;
  readonly arcadeId?: string;
}

const DEFAULT_BASE_URL = 'https://api.arcade.software';

function resolveConfig(options: PublishOptions): ArcadeConfig {
  const apiKey = options.apiKey ?? process.env.ARCADE_API_KEY ?? '';
  if (!apiKey && !options.dryRun) {
    throw new Error('API key required. Use --api-key or set ARCADE_API_KEY environment variable.');
  }
  const baseUrl = options.baseUrl !== DEFAULT_BASE_URL
    ? options.baseUrl
    : process.env.ARCADE_BASE_URL ?? options.baseUrl;
  return {
    apiKey,
    baseUrl,
    dryRun: options.dryRun,
  };
}

async function publish(artifactDir: string, options: PublishOptions): Promise<void> {
  const actionsPath = join(artifactDir, ACTIONS_FILENAME);
  const reportPath = join(artifactDir, 'report.md');
  const videoPath = join(artifactDir, 'recording.webm');

  if (!existsSync(actionsPath)) {
    throw new Error(`${ACTIONS_FILENAME} not found in ${artifactDir}`);
  }

  // Validate API key early — fail fast before parsing if we'll need it
  if (!options.dryRun) {
    resolveConfig(options);
  }

  const actionsContent = readFileSync(actionsPath, 'utf-8');
  const { metadata, actions } = parseActionsFile(actionsContent);

  const report = existsSync(reportPath)
    ? parseReportFile(readFileSync(reportPath, 'utf-8'))
    : { title: '', description: '', sections: [] };

  if (!existsSync(reportPath)) {
    logger.warn('No report.md found, using metadata for title', { artifactDir });
  }

  logger.info('Parsed artifacts', {
    workflow: metadata.workflowName,
    actions: actions.length,
    sections: report.sections.length,
  });

  const arcadeEvents = transformToArcadeEvents(actions);
  const labeledEvents = arcadeEvents.map((event) => ({
    ...event,
    label: event.label ? toImperativeLabel(event.label) : event.label,
  }));

  const manifest = {
    title: report.title || metadata.workflowName,
    description: report.description,
    duration: metadata.duration,
    events: labeledEvents,
    sections: report.sections,
  };

  if (options.dryRun) {
    const output = JSON.stringify(manifest, null, 2);
    if (options.output) {
      writeFileSync(options.output, output, 'utf-8');
      logger.info('Manifest written', { path: options.output });
    } else {
      process.stdout.write(output + '\n');
    }
    return;
  }

  if (!existsSync(videoPath)) {
    throw new Error(`recording.webm not found in ${artifactDir}. Use --dry-run to output the manifest without uploading.`);
  }

  const config = resolveConfig(options);
  const client = new ArcadeClient(config);

  const uploadId = await uploadWorkflowVideo(client, videoPath);

  const request = {
    title: manifest.title,
    description: manifest.description,
    uploadId,
    events: labeledEvents,
  };

  const isUpdate = Boolean(options.arcadeId);
  const response = isUpdate
    ? await client.updateArcade(options.arcadeId!, request)
    : await client.createArcade(request);

  const result: PublishResult = {
    arcadeId: response.arcadeId,
    shareUrl: `${ARCADE_APP_URL}/share/${response.arcadeId}`,
    title: manifest.title,
    steps: labeledEvents.length,
    duration: metadata.duration,
    createdAt: new Date().toISOString(),
  };
  logger.info(isUpdate ? 'Arcade updated' : 'Arcade created', { arcadeId: response.arcadeId });

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

async function publishAll(runDir: string, options: PublishOptions): Promise<void> {
  if (!existsSync(runDir) || !statSync(runDir).isDirectory()) {
    throw new Error(`Run directory not found: ${runDir}`);
  }

  // Validate API key once upfront — fail fast before scanning workflows
  if (!options.dryRun) {
    resolveConfig(options);
  }

  const entries = readdirSync(runDir).filter((entry) => {
    const entryPath = join(runDir, entry);
    return statSync(entryPath).isDirectory();
  });

  logger.info('Scanning run directory', { runDir, subdirectories: entries.length });

  let published = 0;
  let skipped = 0;

  for (const entry of entries) {
    // Handle double-nested structure: <run-dir>/<workflow>/<workflow>/
    const directPath = join(runDir, entry);
    const nestedPath = join(runDir, entry, entry);

    let artifactDir: string;
    if (existsSync(join(nestedPath, ACTIONS_FILENAME))) {
      artifactDir = nestedPath;
    } else if (existsSync(join(directPath, ACTIONS_FILENAME))) {
      artifactDir = directPath;
    } else {
      logger.warn(`Skipping directory, no ${ACTIONS_FILENAME} found`, { directory: entry });
      skipped++;
      continue;
    }

    try {
      logger.info('Publishing workflow', { directory: entry });
      await publish(artifactDir, options);
      published++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to publish workflow', { directory: entry, error: message });
      skipped++;
    }
  }

  logger.info('Publish-all complete', { published, skipped });
}

export function createCli(): Command {
  const program = new Command();

  program
    .name('demo-publisher')
    .description('Transform workflow validation artifacts into interactive Arcade demos')
    .version('0.1.0');

  program
    .command('publish')
    .description('Publish a single workflow artifact directory to Arcade')
    .argument('<artifact-dir>', 'Path to the artifact directory')
    .option('--api-key <key>', 'Arcade API key (or set ARCADE_API_KEY)')
    .option('--base-url <url>', 'Arcade API base URL', DEFAULT_BASE_URL)
    .option('--dry-run', 'Output manifest without uploading', false)
    .option('--output <path>', 'Write manifest to file instead of stdout')
    .option('--arcade-id <id>', 'Existing Arcade ID to update')
    .action(async (artifactDir: string, opts: PublishOptions) => {
      try {
        await publish(artifactDir, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Publish failed', { error: message });
        process.exitCode = 1;
      }
    });

  program
    .command('publish-all')
    .description('Publish all workflow artifacts in a run directory')
    .argument('<run-dir>', 'Path to the run directory')
    .option('--api-key <key>', 'Arcade API key (or set ARCADE_API_KEY)')
    .option('--base-url <url>', 'Arcade API base URL', DEFAULT_BASE_URL)
    .option('--dry-run', 'Output manifests without uploading', false)
    .action(async (runDir: string, opts: PublishOptions) => {
      try {
        await publishAll(runDir, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Publish-all failed', { error: message });
        process.exitCode = 1;
      }
    });

  program
    .command('publish-ext')
    .description('Publish using Arcade internal extension API (cookie auth)')
    .argument('<artifact-dir>', 'Path to the artifact directory')
    .option('--cookie-file <path>', 'Path to file containing Arcade session cookie', '~/.arcade-cookie')
    .option('--video <path>', 'Path to video file (overrides auto-detection)')
    .action(async (artifactDir: string, opts: { cookieFile: string; video?: string }) => {
      try {
        await publishViaExtension(artifactDir, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Publish-ext failed', { error: message });
        process.exitCode = 1;
      }
    });

  program
    .command('publish-video')
    .description('Publish using Arcade "Video to Interactive Demo" via Playwright')
    .argument('<artifact-dir>', 'Path to the artifact directory')
    .option('--cookie-file <path>', 'Path to file containing Arcade session cookie', '~/.arcade-cookie')
    .option('--video <path>', 'Path to video file (overrides auto-detection)')
    .option('--trim', 'Trim idle time from video before uploading', false)
    .action(async (artifactDir: string, opts: { cookieFile: string; video?: string; trim: boolean }) => {
      try {
        await publishViaVideo(artifactDir, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Publish-video failed', { error: message });
        process.exitCode = 1;
      }
    });

  program
    .command('publish-screenshots')
    .description('Publish using screenshots extracted from video at action timestamps')
    .argument('<artifact-dir>', 'Path to the artifact directory')
    .option('--cookie-file <path>', 'Path to file containing Arcade session cookie', '~/.arcade-cookie')
    .option('--storage-state <path>', 'Playwright storage state file (more reliable than cookie)', '~/.arcade-state.json')
    .option('--video <path>', 'Path to video file (overrides auto-detection)')
    .option('--title <title>', 'Demo title (overrides auto-detection from report.md)')
    .option('--enhance', 'Use LLM to generate better callout text', false)
    .action(async (artifactDir: string, opts: { cookieFile: string; storageState: string; video?: string; title?: string; enhance: boolean }) => {
      try {
        await publishViaScreenshots(artifactDir, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Publish-screenshots failed', { error: message });
        process.exitCode = 1;
      }
    });

  return program;
}

async function publishViaScreenshots(
  artifactDir: string,
  opts: { cookieFile: string; storageState: string; video?: string; title?: string; enhance: boolean },
): Promise<void> {
  const actionsPath = join(artifactDir, ACTIONS_FILENAME);
  if (!existsSync(actionsPath)) {
    throw new Error(`${ACTIONS_FILENAME} not found in ${artifactDir}`);
  }

  // Find video
  let videoPath = opts.video;
  if (!videoPath) {
    const recordingPath = join(artifactDir, 'recording.webm');
    if (existsSync(recordingPath)) {
      videoPath = recordingPath;
    } else {
      const webmFiles = readdirSync(artifactDir).filter((f) => f.endsWith('.webm'));
      if (webmFiles.length > 0) {
        videoPath = join(artifactDir, webmFiles[0]);
        logger.info('Using first .webm file found', { file: webmFiles[0] });
      }
    }
  }

  if (!videoPath || !existsSync(videoPath)) {
    throw new Error('No video file found. Use --video to specify one.');
  }

  // Parse actions
  const actionsContent = readFileSync(actionsPath, 'utf-8');
  const { metadata, actions } = parseActionsFile(actionsContent);

  // Get title from report or flag
  let title = opts.title ?? '';
  if (!title) {
    const reportPath = join(artifactDir, 'report.md');
    if (existsSync(reportPath)) {
      const report = parseReportFile(readFileSync(reportPath, 'utf-8'));
      title = report.title;
    }
  }
  if (!title) {
    title = metadata.workflowName;
  }

  // Enhance with LLM if requested
  let callouts: readonly string[] | undefined;
  if (opts.enhance) {
    const enhanced = await enhanceDemo(actions, metadata.workflowName);
    if (!opts.title) title = enhanced.title;
    callouts = enhanced.callouts;
    logger.info('LLM enhancement applied', { title, callouts: callouts.length });
  }

  logger.info('Publishing via screenshots', {
    workflow: metadata.workflowName,
    actions: actions.length,
    clicks: actions.filter((a) => a.type === 'click').length,
    video: videoPath,
    title,
    enhanced: opts.enhance,
  });

  // Load auth
  const cookiePath = opts.cookieFile.replace(/^~/, process.env.HOME ?? '');
  const auth = loadAuth(cookiePath);

  // Resolve storage state path
  const storageStatePath = opts.storageState.replace(/^~/, process.env.HOME ?? '');

  // Publish
  const result = await screenshotsToDemo(auth, videoPath, actions, title, { storageStatePath, callouts });

  process.stdout.write(JSON.stringify({
    flowId: result.flowId,
    editUrl: result.editUrl,
    title: result.title,
    steps: result.steps,
    duration: metadata.duration,
    createdAt: new Date().toISOString(),
  }, null, 2) + '\n');
}

async function publishViaVideo(
  artifactDir: string,
  opts: { cookieFile: string; video?: string; trim: boolean },
): Promise<void> {
  // Find video: explicit flag > recording.webm > any .webm in the directory
  let videoPath = opts.video;
  if (!videoPath) {
    const recordingPath = join(artifactDir, 'recording.webm');
    if (existsSync(recordingPath)) {
      videoPath = recordingPath;
    } else {
      const webmFiles = readdirSync(artifactDir).filter((f) => f.endsWith('.webm'));
      if (webmFiles.length > 0) {
        videoPath = join(artifactDir, webmFiles[0]);
        logger.info('Using first .webm file found', { file: webmFiles[0] });
      }
    }
  }

  if (!videoPath || !existsSync(videoPath)) {
    throw new Error('No video file found. Use --video to specify one.');
  }

  // Parse actions for trimming (if actions.md exists)
  const actionsPath = join(artifactDir, ACTIONS_FILENAME);
  let actions: import('./types.js').DemoAction[] = [];
  if (existsSync(actionsPath)) {
    const actionsContent = readFileSync(actionsPath, 'utf-8');
    const parsed = parseActionsFile(actionsContent);
    actions = [...parsed.actions];
    logger.info('Parsed actions for trimming', { count: actions.length });
  }

  logger.info('Publishing via Video to Interactive Demo', { video: videoPath, trim: opts.trim });

  // Load auth
  const cookiePath = opts.cookieFile.replace(/^~/, process.env.HOME ?? '');
  const auth = loadAuth(cookiePath);

  // Publish
  const result = await videoToDemo(auth, videoPath, {
    cleanupMp4: true,
    trim: opts.trim,
    actions,
  });

  process.stdout.write(JSON.stringify({
    flowId: result.flowId,
    editUrl: result.editUrl,
    title: result.title,
    createdAt: new Date().toISOString(),
  }, null, 2) + '\n');
}

async function publishViaExtension(
  artifactDir: string,
  opts: { cookieFile: string; video?: string },
): Promise<void> {
  const actionsPath = join(artifactDir, ACTIONS_FILENAME);

  if (!existsSync(actionsPath)) {
    throw new Error(`${ACTIONS_FILENAME} not found in ${artifactDir}`);
  }

  // Find video: explicit flag > recording.webm > any .webm in the directory
  let videoPath = opts.video;
  if (!videoPath) {
    const recordingPath = join(artifactDir, 'recording.webm');
    if (existsSync(recordingPath)) {
      videoPath = recordingPath;
    } else {
      const webmFiles = readdirSync(artifactDir).filter((f) => f.endsWith('.webm'));
      if (webmFiles.length > 0) {
        videoPath = join(artifactDir, webmFiles[0]);
        logger.info('Using first .webm file found', { file: webmFiles[0] });
      }
    }
  }

  if (!videoPath || !existsSync(videoPath)) {
    throw new Error('No video file found. Use --video to specify one.');
  }

  // Parse artifacts
  const actionsContent = readFileSync(actionsPath, 'utf-8');
  const { metadata, actions } = parseActionsFile(actionsContent);

  const reportPath = join(artifactDir, 'report.md');
  const report = existsSync(reportPath)
    ? parseReportFile(readFileSync(reportPath, 'utf-8'))
    : { title: '', description: '', sections: [] };

  const arcadeEvents = transformToArcadeEvents(actions);
  const labeledEvents = arcadeEvents.map((event) => ({
    ...event,
    label: event.label ? toImperativeLabel(event.label) : event.label,
  }));

  const title = report.title || metadata.workflowName;
  const description = report.description || `Workflow: ${metadata.workflowName}`;

  logger.info('Parsed artifacts', {
    workflow: metadata.workflowName,
    actions: actions.length,
    events: labeledEvents.length,
    video: videoPath,
  });

  // Resolve cookie file path
  const cookiePath = opts.cookieFile.replace(/^~/, process.env.HOME ?? '');
  const auth = loadAuth(cookiePath);
  const client = new ExtensionClient(auth);

  // Publish
  const result = await extensionPublish(client, {
    title,
    description,
    videoPath,
    actions,
    events: labeledEvents,
  });

  process.stdout.write(JSON.stringify({
    flowId: result.flowId,
    editUrl: result.editUrl,
    title,
    steps: result.steps,
    duration: metadata.duration,
    createdAt: new Date().toISOString(),
  }, null, 2) + '\n');
}
