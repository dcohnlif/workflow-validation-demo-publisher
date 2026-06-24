/**
 * Use an LLM to enhance demo content:
 * - Convert mechanical action labels into descriptive callout text
 * - Generate demo title and description
 */
import { generate } from '../util/claude.js';
import * as logger from '../util/logger.js';
import type { DemoAction } from '../types.js';

export interface EnhancedDemo {
  readonly title: string;
  readonly description: string;
  readonly callouts: readonly string[];
}

/**
 * Generate enhanced demo content from action data.
 * Makes a single LLM call with all actions to get coherent, contextual callouts.
 */
export async function enhanceDemo(
  actions: readonly DemoAction[],
  workflowName: string,
): Promise<EnhancedDemo> {
  const clickActions = actions.filter((a) => a.type === 'click');

  if (clickActions.length === 0) {
    return { title: workflowName, description: '', callouts: [] };
  }

  const actionsText = clickActions
    .map((a, i) => `Step ${i + 1}: ${a.rawNarrative} (Page: ${a.page.title || a.page.url || 'unknown'})`)
    .join('\n');

  const prompt = `You are writing callout text for an interactive product demo of Red Hat OpenShift AI.

The demo shows a user performing the following actions in a web browser:

${actionsText}

Generate:
1. A short, clear TITLE for this demo (max 10 words)
2. A one-sentence DESCRIPTION for the cover page
3. For each step, a brief CALLOUT (1-2 sentences) that explains what the user should do and why. Write in second person ("Click...", "Enter...", "Select..."). Be specific about what UI element to interact with and what it accomplishes.

Format your response EXACTLY as JSON:
{
  "title": "...",
  "description": "...",
  "callouts": ["step 1 callout", "step 2 callout", ...]
}

Return ONLY the JSON, no other text.`;

  try {
    logger.info('Generating enhanced demo content with Claude...', { steps: clickActions.length });
    const response = await generate(prompt, 4096);

    // Parse the JSON response
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Claude response was not valid JSON, using defaults');
      return { title: workflowName, description: '', callouts: clickActions.map((a) => a.rawNarrative) };
    }

    const parsed = JSON.parse(jsonMatch[0]) as { title: string; description: string; callouts: string[] };

    logger.info('Enhanced demo content generated', {
      title: parsed.title,
      callouts: parsed.callouts.length,
      model: response.model,
    });

    return {
      title: parsed.title,
      description: parsed.description,
      callouts: parsed.callouts,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('LLM enhancement failed, using raw labels', { error: message });
    return { title: workflowName, description: '', callouts: clickActions.map((a) => a.rawNarrative) };
  }
}
