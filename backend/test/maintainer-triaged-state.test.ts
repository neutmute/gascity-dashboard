import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadTriagedState,
  setTriaged,
  type TriagedState,
} from '../src/maintainer/triaged-state.js';

// Unit tests for the triaged-state module (gascity-dashboard-2ax).
// State persists in a separate JSON file from the maintainer cache so it
// survives nightly cache rewrites. Mirrors storage.ts's tmp+rename pattern
// and adds an in-process mutex to serialize concurrent writes from two
// tabs / clients.

let tmpDir: string;
let statePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'triaged-state-test-'));
  statePath = path.join(tmpDir, 'triaged-state.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('loadTriagedState', () => {
  test('returns empty map when file does not exist', async () => {
    const state = await loadTriagedState(statePath);
    assert.equal(Object.keys(state).length, 0);
  });

  test('parses an existing file', async () => {
    const seed: TriagedState = {
      'pr:47': { triaged_at: '2026-05-22T10:00:00.000Z' },
      'issue:12': { triaged_at: '2026-05-22T11:00:00.000Z' },
    };
    await fs.writeFile(statePath, JSON.stringify(seed), 'utf-8');
    const state = await loadTriagedState(statePath);
    assert.equal(state['pr:47']?.triaged_at, '2026-05-22T10:00:00.000Z');
    assert.equal(state['issue:12']?.triaged_at, '2026-05-22T11:00:00.000Z');
  });

  test('returns empty map on parse error (corrupted file)', async () => {
    await fs.writeFile(statePath, 'not json', 'utf-8');
    const state = await loadTriagedState(statePath);
    assert.equal(Object.keys(state).length, 0);
  });

  test('returns empty map when file is not an object', async () => {
    await fs.writeFile(statePath, '"a string"', 'utf-8');
    const state = await loadTriagedState(statePath);
    assert.equal(Object.keys(state).length, 0);
  });

  test('drops entries with non-string timestamp', async () => {
    const seed = {
      'pr:47': { triaged_at: 12345 },
      'issue:12': { triaged_at: '2026-05-22T11:00:00.000Z' },
    };
    await fs.writeFile(statePath, JSON.stringify(seed), 'utf-8');
    const state = await loadTriagedState(statePath);
    assert.equal(state['pr:47'], undefined);
    assert.equal(state['issue:12']?.triaged_at, '2026-05-22T11:00:00.000Z');
  });
});

describe('setTriaged', () => {
  test('marks one item triaged and persists', async () => {
    const result = await setTriaged(
      statePath,
      [{ kind: 'pr', number: 47 }],
      true,
    );
    assert.equal(result.updated.length, 1);
    assert.deepEqual(result.updated[0], { kind: 'pr', number: 47 });

    const reread = await loadTriagedState(statePath);
    assert.ok(reread['pr:47']?.triaged_at, 'entry should exist');
    const ts = new Date(reread['pr:47']!.triaged_at).getTime();
    assert.ok(Number.isFinite(ts), 'timestamp should be ISO-parseable');
  });

  test('marks many items triaged in one call', async () => {
    await setTriaged(
      statePath,
      [
        { kind: 'pr', number: 47 },
        { kind: 'issue', number: 12 },
        { kind: 'pr', number: 99 },
      ],
      true,
    );
    const state = await loadTriagedState(statePath);
    assert.ok(state['pr:47']?.triaged_at);
    assert.ok(state['issue:12']?.triaged_at);
    assert.ok(state['pr:99']?.triaged_at);
  });

  test('flipping back to false removes entries from state', async () => {
    await setTriaged(statePath, [{ kind: 'pr', number: 47 }], true);
    await setTriaged(statePath, [{ kind: 'pr', number: 47 }], false);
    const state = await loadTriagedState(statePath);
    assert.equal(state['pr:47'], undefined);
  });

  test('flipping false does NOT remove unrelated entries', async () => {
    await setTriaged(
      statePath,
      [
        { kind: 'pr', number: 47 },
        { kind: 'issue', number: 12 },
      ],
      true,
    );
    await setTriaged(statePath, [{ kind: 'pr', number: 47 }], false);
    const state = await loadTriagedState(statePath);
    assert.equal(state['pr:47'], undefined);
    assert.ok(state['issue:12']?.triaged_at, 'unrelated entry should survive');
  });

  test('creates parent directory if missing', async () => {
    const nested = path.join(tmpDir, 'nested', 'deeper', 'state.json');
    await setTriaged(nested, [{ kind: 'pr', number: 1 }], true);
    const state = await loadTriagedState(nested);
    assert.ok(state['pr:1']?.triaged_at);
  });

  test('many concurrent writes from different tabs do not lose updates (mutex)', async () => {
    // Read-modify-write under Promise.all: each call awaits fs.readFile
    // and fs.writeFile, both of which yield the event loop. Without the
    // in-process mutex, branches interleave their reads BEFORE any of
    // them writes — and a later writer clobbers earlier writers' work.
    // 25 concurrent items: in 25+ trials a missing mutex drops at least
    // one entry essentially every time. With the mutex, all 25 land.
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        setTriaged(statePath, [{ kind: 'pr', number: i + 1 }], true),
      ),
    );
    const state = await loadTriagedState(statePath);
    const present = Object.keys(state);
    assert.equal(
      present.length,
      N,
      `expected ${N} entries, got ${present.length}: ${present.join(',')}`,
    );
    for (let i = 1; i <= N; i++) {
      assert.ok(state[`pr:${i}`]?.triaged_at, `pr:${i} should survive`);
    }
  });

  test('atomic write: leaves no tmp file after success', async () => {
    await setTriaged(statePath, [{ kind: 'pr', number: 1 }], true);
    const entries = await fs.readdir(path.dirname(statePath));
    const stragglers = entries.filter((f) => f.includes('.tmp-'));
    assert.equal(stragglers.length, 0, `unexpected tmp files: ${stragglers.join(', ')}`);
  });
});
