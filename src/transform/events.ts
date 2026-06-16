import type { DemoAction, ArcadeEvent } from '../types.js';

const INTERACTIVE_TYPES = new Set(['click', 'type', 'keypress', 'scroll']);

export function transformToArcadeEvents(actions: readonly DemoAction[]): ArcadeEvent[] {
  return actions
    .filter((action) => INTERACTIVE_TYPES.has(action.type))
    .map((action): ArcadeEvent => {
      switch (action.type) {
        case 'click':
          return {
            type: 'click',
            timestamp: action.timestamp,
            target: action.target,
            label: action.rawNarrative,
          };
        case 'type':
        case 'keypress':
          return {
            type: 'type',
            timestamp: action.timestamp,
          };
        case 'scroll':
          return {
            type: 'scroll',
            timestamp: action.timestamp,
          };
        default:
          return {
            type: 'click',
            timestamp: action.timestamp,
          };
      }
    });
}
