import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformToArcadeEvents } from '../../src/transform/events.js';
import type { DemoAction } from '../../src/types.js';

function makeAction(overrides: Partial<DemoAction> & { type: DemoAction['type'] }): DemoAction {
  return {
    index: 1,
    type: overrides.type,
    rawTool: '',
    timestamp: 0,
    rawTimestamp: '00:00:00',
    page: {},
    rawNarrative: '',
    ...overrides,
  };
}

describe('transformToArcadeEvents', () => {
  it('should filter out navigate and observe actions', () => {
    const actions: DemoAction[] = [
      makeAction({ type: 'navigate', index: 1, timestamp: 0 }),
      makeAction({ type: 'click', index: 2, timestamp: 5 }),
      makeAction({ type: 'observe', index: 3, timestamp: 10 }),
      makeAction({ type: 'type', index: 4, timestamp: 15 }),
    ];

    const events = transformToArcadeEvents(actions);
    assert.equal(events.length, 2);
  });

  it('should map click to ArcadeEvent click', () => {
    const actions: DemoAction[] = [
      makeAction({ type: 'click', index: 1, timestamp: 5 }),
    ];

    const events = transformToArcadeEvents(actions);
    assert.equal(events[0].type, 'click');
  });

  it('should map type to ArcadeEvent type', () => {
    const actions: DemoAction[] = [
      makeAction({ type: 'type', index: 1, timestamp: 10 }),
    ];

    const events = transformToArcadeEvents(actions);
    assert.equal(events[0].type, 'type');
  });

  it('should map keypress to ArcadeEvent type', () => {
    const actions: DemoAction[] = [
      makeAction({ type: 'keypress', index: 1, timestamp: 10 }),
    ];

    const events = transformToArcadeEvents(actions);
    assert.equal(events[0].type, 'type');
  });

  it('should map scroll to ArcadeEvent scroll', () => {
    const actions: DemoAction[] = [
      makeAction({ type: 'scroll', index: 1, timestamp: 20 }),
    ];

    const events = transformToArcadeEvents(actions);
    assert.equal(events[0].type, 'scroll');
  });

  it('should preserve timestamps', () => {
    const actions: DemoAction[] = [
      makeAction({ type: 'click', index: 1, timestamp: 5 }),
      makeAction({ type: 'type', index: 2, timestamp: 13 }),
      makeAction({ type: 'scroll', index: 3, timestamp: 30 }),
    ];

    const events = transformToArcadeEvents(actions);
    assert.equal(events[0].timestamp, 5);
    assert.equal(events[1].timestamp, 13);
    assert.equal(events[2].timestamp, 30);
  });

  it('should include target coordinates when available', () => {
    const actions: DemoAction[] = [
      makeAction({ type: 'click', index: 1, timestamp: 5, target: { x: 100, y: 200 } }),
    ];

    const events = transformToArcadeEvents(actions);
    assert.deepEqual(events[0].target, { x: 100, y: 200 });
  });

  it('should include label from rawNarrative for click events', () => {
    const actions: DemoAction[] = [
      makeAction({ type: 'click', index: 1, timestamp: 5, rawNarrative: 'Clicked the button' }),
    ];

    const events = transformToArcadeEvents(actions);
    assert.equal(events[0].label, 'Clicked the button');
  });

  it('should filter out screenshot actions', () => {
    const actions: DemoAction[] = [
      makeAction({ type: 'screenshot', index: 1, timestamp: 5 }),
      makeAction({ type: 'click', index: 2, timestamp: 10 }),
    ];

    const events = transformToArcadeEvents(actions);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'click');
  });
});
