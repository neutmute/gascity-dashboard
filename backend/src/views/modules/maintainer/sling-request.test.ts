import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSlingRequest } from './sling-request.js';

const defaults = {
  slingTarget: 'mayor',
  triageTarget: 'chief-of-staff',
};

test('decodeSlingRequest defaults triage intent to the triage target and composes bead text', () => {
  const decoded = decodeSlingRequest(
    {
      kind: 'issue',
      number: 47,
      html_url: 'https://github.com/gastownhall/gascity/issues/47',
      intent: 'triage',
    },
    defaults,
  );

  assert.equal(decoded.status, 'ok');
  assert.equal(decoded.request.target, 'chief-of-staff');
  assert.equal(decoded.request.beadText, 'Please triage https://github.com/gastownhall/gascity/issues/47');
});

test('decodeSlingRequest keeps draft intent on the generic sling target', () => {
  const decoded = decodeSlingRequest(
    {
      kind: 'issue',
      number: 47,
      html_url: 'https://github.com/gastownhall/gascity/issues/47',
      intent: 'draft',
    },
    defaults,
  );

  assert.equal(decoded.status, 'ok');
  assert.equal(decoded.request.target, 'mayor');
  assert.equal(decoded.request.beadText, 'Please draft a PR addressing https://github.com/gastownhall/gascity/issues/47');
});

test('decodeSlingRequest rejects a kind/html_url mismatch', () => {
  const decoded = decodeSlingRequest(
    {
      kind: 'pr',
      number: 47,
      html_url: 'https://github.com/gastownhall/gascity/issues/47',
      intent: 'review',
    },
    defaults,
  );

  assert.deepEqual(decoded, {
    status: 'error',
    message: 'kind/html_url mismatch',
  });
});

test('decodeSlingRequest rejects malformed explicit targets before dispatch', () => {
  const decoded = decodeSlingRequest(
    {
      kind: 'issue',
      number: 47,
      html_url: 'https://github.com/gastownhall/gascity/issues/47',
      intent: 'triage',
      target: '../bad',
    },
    defaults,
  );

  assert.deepEqual(decoded, {
    status: 'error',
    message: 'invalid target alias',
  });
});
