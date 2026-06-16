import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toImperativeLabel } from '../../src/transform/labels.js';

describe('toImperativeLabel', () => {
  it('should convert "Clicked" to "Click"', () => {
    assert.equal(
      toImperativeLabel('Clicked "Create Project"'),
      'Click "Create Project"',
    );
  });

  it('should convert "Typed" to "Type"', () => {
    assert.equal(
      toImperativeLabel('Typed "hello" into "Name"'),
      'Type "hello" into "Name"',
    );
  });

  it('should convert "Filled form" to "Fill form"', () => {
    assert.equal(
      toImperativeLabel('Filled form: X = Y'),
      'Fill form: X = Y',
    );
  });

  it('should convert "Pressed key" to "Press key"', () => {
    assert.equal(
      toImperativeLabel('Pressed key: Enter'),
      'Press key: Enter',
    );
  });

  it('should convert "Navigated" to "Navigate"', () => {
    assert.equal(
      toImperativeLabel('Navigated to https://example.com'),
      'Navigate to https://example.com',
    );
  });

  it('should convert "Selected" to "Select"', () => {
    assert.equal(
      toImperativeLabel('Selected "Option A"'),
      'Select "Option A"',
    );
  });

  it('should convert "Scrolled" to "Scroll"', () => {
    assert.equal(
      toImperativeLabel('Scrolled down'),
      'Scroll down',
    );
  });

  it('should convert "Observed" to "Observe"', () => {
    assert.equal(
      toImperativeLabel('Observed the page state'),
      'Observe the page state',
    );
  });

  it('should convert "Hovered" to "Hover"', () => {
    assert.equal(
      toImperativeLabel('Hovered over the menu'),
      'Hover over the menu',
    );
  });

  it('should convert "Waited" to "Wait"', () => {
    assert.equal(
      toImperativeLabel('Waited for page to load'),
      'Wait for page to load',
    );
  });

  it('should return unknown prefix as-is', () => {
    assert.equal(
      toImperativeLabel('Did something unexpected'),
      'Did something unexpected',
    );
  });
});
