import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatPartialErrors,
  isPartialList,
  partialReasonsFromList,
} from '../src/lib/partial-list.js';

describe('partial list helpers', () => {
  test('treats partial=true as degraded even without error detail', () => {
    assert.equal(isPartialList({ partial: true }), true);
    assert.deepEqual(partialReasonsFromList({ partial: true }), []);
  });

  test('treats non-empty partial_errors as degraded even when partial is absent', () => {
    assert.equal(isPartialList({ partial_errors: ['rig offline'] }), true);
    assert.deepEqual(partialReasonsFromList({ partial_errors: ['rig offline'] }), ['rig offline']);
  });

  test('does not treat empty or absent partial_errors as degraded', () => {
    assert.equal(isPartialList({}), false);
    assert.equal(isPartialList({ partial: false, partial_errors: [] }), false);
  });

  test('formats partial errors for logs with newline sanitization', () => {
    assert.equal(formatPartialErrors(undefined), 'no detail');
    assert.equal(
      formatPartialErrors(['rig one\noffline', 'rig two\runavailable']),
      'rig one offline, rig two unavailable',
    );
  });
});
