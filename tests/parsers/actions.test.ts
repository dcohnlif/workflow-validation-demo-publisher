import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseActionsFile } from '../../src/parsers/actions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureContent = readFileSync(join(__dirname, '..', 'fixtures', 'actions.md'), 'utf-8');

describe('parseActionsFile', () => {
  describe('metadata parsing', () => {
    it('should parse workflowName', () => {
      const { metadata } = parseActionsFile(fixtureContent);
      assert.equal(metadata.workflowName, 'sample-workflow');
    });

    it('should parse generatedAt', () => {
      const { metadata } = parseActionsFile(fixtureContent);
      assert.equal(metadata.generatedAt, '2026-06-10T10:00:00.000Z');
    });

    it('should parse totalActions', () => {
      const { metadata } = parseActionsFile(fixtureContent);
      assert.equal(metadata.totalActions, 5);
    });

    it('should parse duration', () => {
      const { metadata } = parseActionsFile(fixtureContent);
      assert.equal(metadata.duration, '2m 30s');
    });
  });

  describe('detailed actions parsing', () => {
    it('should parse all 5 actions from Detailed Actions section', () => {
      const { actions } = parseActionsFile(fixtureContent);
      assert.equal(actions.length, 5);
    });

    it('should map types correctly', () => {
      const { actions } = parseActionsFile(fixtureContent);
      assert.equal(actions[0].type, 'navigate');
      assert.equal(actions[1].type, 'click');
      assert.equal(actions[2].type, 'type');
      assert.equal(actions[3].type, 'type');  // browser_fill_form -> type
      assert.equal(actions[4].type, 'click');
    });

    it('should set correct rawTool values', () => {
      const { actions } = parseActionsFile(fixtureContent);
      assert.equal(actions[0].rawTool, 'browser_navigate');
      assert.equal(actions[1].rawTool, 'browser_click');
      assert.equal(actions[2].rawTool, 'browser_type');
      assert.equal(actions[3].rawTool, 'browser_fill_form');
      assert.equal(actions[4].rawTool, 'browser_click');
    });

    it('should compute correct relative timestamps', () => {
      const { actions } = parseActionsFile(fixtureContent);
      assert.equal(actions[0].timestamp, 0);
      assert.equal(actions[1].timestamp, 5);
      assert.equal(actions[2].timestamp, 13);
      assert.equal(actions[3].timestamp, 20);
      assert.equal(actions[4].timestamp, 30);
    });

    it('should preserve rawTimestamp values', () => {
      const { actions } = parseActionsFile(fixtureContent);
      assert.equal(actions[0].rawTimestamp, '10:00:05');
      assert.equal(actions[1].rawTimestamp, '10:00:10');
      assert.equal(actions[2].rawTimestamp, '10:00:18');
      assert.equal(actions[3].rawTimestamp, '10:00:25');
      assert.equal(actions[4].rawTimestamp, '10:00:35');
    });

    it('should parse page URLs', () => {
      const { actions } = parseActionsFile(fixtureContent);
      assert.equal(actions[0].page.url, 'https://example.com/dashboard');
      assert.equal(actions[1].page.url, 'https://example.com/dashboard');
      assert.equal(actions[2].page.url, 'https://example.com/create');
      assert.equal(actions[3].page.url, 'https://example.com/create');
      assert.equal(actions[4].page.url, 'https://example.com/create');
    });

    it('should preserve rawNarrative', () => {
      const { actions } = parseActionsFile(fixtureContent);
      assert.equal(actions[0].rawNarrative, 'Navigated to https://example.com/dashboard');
      assert.equal(actions[1].rawNarrative, 'Clicked "Create Project button"');
      assert.equal(actions[2].rawNarrative, 'Typed "my-project" into "Project name"');
      assert.equal(actions[3].rawNarrative, 'Filled form: Description = "A test project"');
      assert.equal(actions[4].rawNarrative, 'Clicked "Submit button"');
    });
  });

  describe('timeline table fallback', () => {
    it('should fall back to Timeline table when Detailed Actions is missing', () => {
      const contentWithoutDetailed = fixtureContent.split('## Detailed Actions')[0];
      const { actions } = parseActionsFile(contentWithoutDetailed);

      assert.equal(actions.length, 5);
      assert.equal(actions[0].type, 'navigate');
      assert.equal(actions[1].type, 'click');
      assert.equal(actions[2].type, 'type');
      assert.equal(actions[3].type, 'type');  // "Filled form" -> type
      assert.equal(actions[4].type, 'click');
    });

    it('should set rawTool to empty string for Timeline-parsed actions', () => {
      const contentWithoutDetailed = fixtureContent.split('## Detailed Actions')[0];
      const { actions } = parseActionsFile(contentWithoutDetailed);

      for (const action of actions) {
        assert.equal(action.rawTool, '');
      }
    });

    it('should compute relative timestamps from Timeline', () => {
      const contentWithoutDetailed = fixtureContent.split('## Detailed Actions')[0];
      const { actions } = parseActionsFile(contentWithoutDetailed);

      assert.equal(actions[0].timestamp, 0);
      assert.equal(actions[1].timestamp, 5);
      assert.equal(actions[2].timestamp, 13);
      assert.equal(actions[3].timestamp, 20);
      assert.equal(actions[4].timestamp, 30);
    });
  });
});
