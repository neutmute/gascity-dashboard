import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  RUN_REVIEWABLE_PATHS,
  classifyRunDiffFile,
  isReviewableRunDiffPath,
} from '../src/runs/run-diff-policy.js';

describe('run diff reviewability policy', () => {
  test('exports git pathspecs that exclude top-level control-plane directories', () => {
    assert.deepEqual(RUN_REVIEWABLE_PATHS, [
      '--',
      ':/',
      ':(exclude,top).beads',
      ':(exclude,top).beads/**',
      ':(exclude,top).gc',
      ':(exclude,top).gc/**',
    ]);
  });

  test('string predicate matches the top-level control-plane exclusion', () => {
    assert.equal(isReviewableRunDiffPath('.beads'), false);
    assert.equal(isReviewableRunDiffPath('.beads/metadata.json'), false);
    assert.equal(isReviewableRunDiffPath('a/.gc/events.jsonl'), false);
    assert.equal(isReviewableRunDiffPath('"b/.gc/system/settings.json"'), false);

    assert.equal(isReviewableRunDiffPath('.gcfoo/settings.json'), true);
    assert.equal(isReviewableRunDiffPath('src/.gc/settings.json'), true);
    assert.equal(isReviewableRunDiffPath('src/app.ts'), true);
  });

  test('classifies changed files once for tracked and untracked diff paths', () => {
    assert.equal(classifyRunDiffFile('src/app.ts'), 'code');
    assert.equal(classifyRunDiffFile('src/app.test.tsx'), 'test');
    assert.equal(classifyRunDiffFile('docs/readme.md'), 'docs');
    assert.equal(classifyRunDiffFile('package.json'), 'config');
    assert.equal(classifyRunDiffFile('assets/logo.png'), 'other');
  });
});
