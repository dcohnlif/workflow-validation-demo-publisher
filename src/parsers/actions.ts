/* eslint-disable sonarjs/slow-regex -- regexes operate on trusted local markdown file lines */
import type { ActionType, DemoAction, ActionLogMetadata } from '../types.js';

function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] ?? 0;
}

function mapToolToActionType(tool: string, narrative: string): ActionType {
  switch (tool) {
    case 'browser_click':
      return 'click';
    case 'browser_type':
    case 'browser_fill_form':
      return 'type';
    case 'browser_navigate':
      return 'navigate';
    case 'browser_snapshot':
    case 'browser_take_screenshot':
      return 'screenshot';
    case 'browser_press_key':
      return 'keypress';
    case 'browser_wait_for':
      return 'observe';
    case 'browser_evaluate':
      if (/scroll/i.test(narrative)) {
        return 'scroll';
      }
      return 'other';
    default:
      return 'other';
  }
}

function inferTypeFromNarrative(narrative: string): ActionType {
  if (/^(Clicked|Selected)\b/.test(narrative)) return 'click';
  if (/^(Typed|Filled form)\b/.test(narrative)) return 'type';
  if (/^Navigated\b/.test(narrative)) return 'navigate';
  if (/^(Observed|Waited)\b/.test(narrative)) return 'observe';
  if (/^Took screenshot\b/.test(narrative)) return 'screenshot';
  if (/^Pressed key\b/.test(narrative)) return 'keypress';
  if (/^Scrolled\b/.test(narrative)) return 'scroll';
  return 'other';
}

function parseMetadata(content: string): ActionLogMetadata {
  const workflowMatch = content.match(/^# Browser Action Log:\s*([^\n]+)$/m);
  const generatedMatch = content.match(/^Generated:\s*([^\n]+)$/m);
  const totalMatch = content.match(/^Total actions:\s*(\d+)/m);
  const durationMatch = content.match(/^Duration:\s*([^\n]+)$/m);

  return {
    workflowName: workflowMatch?.[1]?.trim() ?? 'unknown',
    generatedAt: generatedMatch?.[1]?.trim() ?? new Date().toISOString(),
    totalActions: totalMatch ? parseInt(totalMatch[1], 10) : 0,
    duration: durationMatch?.[1]?.trim() ?? '0s',
  };
}

function parseDetailedActions(content: string): DemoAction[] | null {
  const detailedIdx = content.indexOf('## Detailed Actions');
  if (detailedIdx === -1) return null;

  const rawSection = content.slice(detailedIdx);
  const nextSectionIdx = rawSection.indexOf('\n## ', 1);
  const detailedSection = nextSectionIdx === -1 ? rawSection : rawSection.slice(0, nextSectionIdx);
  const actionBlocks = detailedSection.split(/^### /m).slice(1);

  if (actionBlocks.length === 0) return null;

  const rawActions: { index: number; narrative: string; rawTimestamp: string; rawTool: string; pageUrl?: string }[] = [];

  for (const block of actionBlocks) {
    const lines = block.split('\n');
    const headingLine = lines[0]?.trim() ?? '';

    // Parse heading: "{index}. {narrative}"
    const headingMatch = headingLine.match(/^(\d+)\.\s+([^\n]+)$/);
    if (!headingMatch) continue;

    const index = parseInt(headingMatch[1], 10);
    const narrative = headingMatch[2].trim();

    // Parse time and tool: "*HH:MM:SS* — `tool_name`"
    let rawTimestamp = '00:00:00';
    let rawTool = '';
    for (const line of lines.slice(1)) {
      const timeToolMatch = line.match(/^\*(\d{1,2}:\d{2}:\d{2})\*\s*—\s*`([^`]+)`/);
      if (timeToolMatch) {
        rawTimestamp = timeToolMatch[1];
        rawTool = timeToolMatch[2];
        break;
      }
    }

    // Parse page URL: "Page: {url}"
    let pageUrl: string | undefined;
    for (const line of lines.slice(1)) {
      const pageMatch = line.match(/^Page:\s*([^\n]+)$/);
      if (pageMatch) {
        pageUrl = pageMatch[1].trim();
        break;
      }
    }

    rawActions.push({ index, narrative, rawTimestamp, rawTool, pageUrl });
  }

  if (rawActions.length === 0) return null;

  const firstSeconds = parseTimeToSeconds(rawActions[0].rawTimestamp);

  return rawActions.map((raw) => ({
    index: raw.index,
    type: mapToolToActionType(raw.rawTool, raw.narrative),
    rawTool: raw.rawTool,
    timestamp: parseTimeToSeconds(raw.rawTimestamp) - firstSeconds,
    rawTimestamp: raw.rawTimestamp,
    page: { url: raw.pageUrl },
    rawNarrative: raw.narrative,
  }));
}

function parseTimelineTable(content: string): DemoAction[] | null {
  const timelineIdx = content.indexOf('## Timeline');
  if (timelineIdx === -1) return null;

  // Find the table after ## Timeline, bounded to section end
  const rawSection = content.slice(timelineIdx);
  const nextSectionIdx = rawSection.indexOf('\n## ', 1);
  const timelineSection = nextSectionIdx === -1 ? rawSection : rawSection.slice(0, nextSectionIdx);
  const lines = timelineSection.split('\n');

  const rawActions: { index: number; narrative: string; rawTimestamp: string; page?: string }[] = [];

  for (const line of lines) {
    // Match table rows: | {index} | {time} | {narrative} | {page} |
    const rowMatch = line.match(/^\|\s*(\d+)\s*\|\s*(\S+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/);
    if (rowMatch) {
      rawActions.push({
        index: parseInt(rowMatch[1], 10),
        rawTimestamp: rowMatch[2],
        narrative: rowMatch[3].trim(),
        page: rowMatch[4].trim() || undefined,
      });
    }
  }

  if (rawActions.length === 0) return null;

  const firstSeconds = parseTimeToSeconds(rawActions[0].rawTimestamp);

  return rawActions.map((raw) => ({
    index: raw.index,
    type: inferTypeFromNarrative(raw.narrative),
    rawTool: '',
    timestamp: parseTimeToSeconds(raw.rawTimestamp) - firstSeconds,
    rawTimestamp: raw.rawTimestamp,
    page: { title: raw.page },
    rawNarrative: raw.narrative,
  }));
}

export function parseActionsFile(content: string): { metadata: ActionLogMetadata; actions: DemoAction[] } {
  const metadata = parseMetadata(content);

  // Try Detailed Actions first, fall back to Timeline table
  const actions = parseDetailedActions(content) ?? parseTimelineTable(content) ?? [];

  return { metadata, actions };
}
