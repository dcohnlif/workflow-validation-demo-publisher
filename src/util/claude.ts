/**
 * Lightweight Claude client for generating demo callout text.
 * Uses Anthropic SDK with Vertex AI backend (same as workflow-validation-insights).
 */
import Anthropic from '@anthropic-ai/sdk';
import * as logger from './logger.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6@default';
const DEFAULT_MAX_TOKENS = 4096;

interface ClaudeResponse {
  text: string;
  model: string;
}

let cachedClient: Anthropic | null = null;

async function getClient(): Promise<Anthropic> {
  if (cachedClient) return cachedClient;

  const vertexProject = process.env.ANTHROPIC_VERTEX_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const vertexRegion = process.env.CLOUD_ML_REGION ?? process.env.VERTEX_LOCATION ?? 'us-east5';

  if (vertexProject) {
    const { AnthropicVertex } = await import('@anthropic-ai/vertex-sdk');
    logger.info('Using Vertex AI backend', { project: vertexProject, region: vertexRegion });
    cachedClient = new AnthropicVertex({ projectId: vertexProject, region: vertexRegion }) as unknown as Anthropic;
    return cachedClient;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    logger.info('Using direct Anthropic API');
    cachedClient = new Anthropic({ apiKey });
    return cachedClient;
  }

  throw new Error(
    'Claude API requires either:\n' +
    '  - GOOGLE_CLOUD_PROJECT + CLOUD_ML_REGION (for Vertex AI)\n' +
    '  - ANTHROPIC_API_KEY (for direct API)\n' +
    'Neither is configured.',
  );
}

export async function generate(prompt: string, maxTokens = DEFAULT_MAX_TOKENS): Promise<ClaudeResponse> {
  const client = await getClient();

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => 'text' in block ? block.text : '')
    .join('\n');

  return { text, model: response.model };
}
