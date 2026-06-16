import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReportFile } from '../../src/parsers/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureContent = readFileSync(join(__dirname, '..', 'fixtures', 'report.md'), 'utf-8');

describe('parseReportFile', () => {
  it('should extract the title', () => {
    const result = parseReportFile(fixtureContent);
    assert.equal(result.title, 'Sample Workflow Validation Report');
  });

  it('should extract the description', () => {
    const result = parseReportFile(fixtureContent);
    assert.equal(
      result.description,
      'This workflow validates the project creation flow on the dashboard.',
    );
  });

  it('should extract chapters from ## headings', () => {
    const result = parseReportFile(fixtureContent);
    assert.equal(result.chapters.length, 3);
    assert.equal(result.chapters[0].title, 'Task 1: Navigate to Dashboard');
    assert.equal(result.chapters[1].title, 'Task 2: Create a New Project');
    assert.equal(result.chapters[2].title, 'Summary');
  });

  it('should handle empty description', () => {
    const content = '# Title\n## Chapter 1\nSome content';
    const result = parseReportFile(content);
    assert.equal(result.title, 'Title');
    assert.equal(result.description, '');
  });

  it('should handle report with no chapters', () => {
    const content = '# Title\n\nSome description text.';
    const result = parseReportFile(content);
    assert.equal(result.title, 'Title');
    assert.equal(result.description, 'Some description text.');
    assert.equal(result.chapters.length, 0);
  });
});
