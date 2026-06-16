/** Action types derived from Playwright MCP tool names */
export type ActionType =
  | 'click'
  | 'type'
  | 'scroll'
  | 'navigate'
  | 'observe'
  | 'keypress'
  | 'screenshot'
  | 'other';

/** A parsed browser action from actions.md */
export interface DemoAction {
  readonly index: number;
  readonly type: ActionType;
  readonly rawTool: string;
  readonly timestamp: number;       // seconds from first action
  readonly rawTimestamp: string;     // original HH:MM:SS
  readonly target?: { readonly x: number; readonly y: number };
  readonly label?: string;
  readonly elementRef?: string;
  readonly page: {
    readonly url?: string;
    readonly title?: string;
  };
  readonly rawNarrative: string;
}

/** A chapter boundary from report.md */
export interface DemoChapter {
  readonly title: string;
  readonly timestampStart: number;
}

/** Full parsed workflow demo data */
export interface WorkflowDemo {
  readonly title: string;
  readonly description: string;
  readonly videoPath: string;
  readonly actions: readonly DemoAction[];
  readonly chapters: readonly DemoChapter[];
  readonly screenshots: readonly string[];
}

/** Arcade API event format */
export interface ArcadeEvent {
  readonly type: 'click' | 'scroll' | 'type';
  readonly timestamp: number;
  readonly target?: { readonly x: number; readonly y: number };
  readonly label?: string;
}

/** Arcade API configuration */
export interface ArcadeConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly dryRun: boolean;
}

/** Result of publishing to Arcade */
export interface PublishResult {
  readonly arcadeId: string;
  readonly shareUrl: string;
  readonly title: string;
  readonly steps: number;
  readonly duration: string;
  readonly createdAt: string;
}

/** Metadata extracted from actions.md header */
export interface ActionLogMetadata {
  readonly workflowName: string;
  readonly generatedAt: string;    // ISO 8601
  readonly totalActions: number;
  readonly duration: string;
}
