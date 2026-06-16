import { Command } from 'commander';
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseActionsFile } from './parsers/actions.js';
import { parseReportFile } from './parsers/report.js';
import { transformToArcadeEvents } from './transform/events.js';
import { toImperativeLabel } from './transform/labels.js';
import { ArcadeClient } from './arcade/client.js';
import { uploadWorkflowVideo } from './arcade/upload.js';
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

function resolveConfig(options: PublishOptions): ArcadeConfig {
  const apiKey = options.apiKey ?? process.env.ARCADE_API_KEY ?? '';
  if (!apiKey && !options.dryRun) {
    throw new Error('API key required. Use --api-key or set ARCADE_API_KEY environment variable.');
  }
  return {
    apiKey,
    baseUrl: options.baseUrl,
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
  if (!existsSync(reportPath)) {
    throw new Error(`report.md not found in ${artifactDir}`);
  }

  const actionsContent = readFileSync(actionsPath, 'utf-8');
  const reportContent = readFileSync(reportPath, 'utf-8');

  const { metadata, actions } = parseActionsFile(actionsContent);
  const report = parseReportFile(reportContent);

  logger.info('Parsed artifacts', {
    workflow: metadata.workflowName,
    actions: actions.length,
    chapters: report.chapters.length,
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
    chapters: report.chapters,
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

  let result: PublishResult;
  if (options.arcadeId) {
    const response = await client.updateArcade(options.arcadeId, request);
    result = {
      arcadeId: response.arcadeId,
      shareUrl: `${ARCADE_APP_URL}/share/${response.arcadeId}`,
      title: manifest.title,
      steps: labeledEvents.length,
      duration: metadata.duration,
      createdAt: new Date().toISOString(),
    };
    logger.info('Arcade updated', { arcadeId: response.arcadeId });
  } else {
    const response = await client.createArcade(request);
    result = {
      arcadeId: response.arcadeId,
      shareUrl: `${ARCADE_APP_URL}/share/${response.arcadeId}`,
      title: manifest.title,
      steps: labeledEvents.length,
      duration: metadata.duration,
      createdAt: new Date().toISOString(),
    };
    logger.info('Arcade created', { arcadeId: response.arcadeId });
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

async function publishAll(runDir: string, options: PublishOptions): Promise<void> {
  if (!existsSync(runDir) || !statSync(runDir).isDirectory()) {
    throw new Error(`Run directory not found: ${runDir}`);
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
    .option('--base-url <url>', 'Arcade API base URL', 'https://api.arcade.software/v1')
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
    .option('--base-url <url>', 'Arcade API base URL', 'https://api.arcade.software/v1')
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

  return program;
}
