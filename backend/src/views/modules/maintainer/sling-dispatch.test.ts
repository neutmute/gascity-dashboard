import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { setAuditLogPath } from '../../../audit.js';
import type { GcSession, SlingInput, SlingResponse } from 'gas-city-dashboard-shared';
import { readSlungState } from './slung-state.js';
import { dispatchMaintainerSling } from './sling-dispatch.js';
import type { DecodedSlingRequest } from './sling-request.js';

interface TestPaths {
  readonly dir: string;
  readonly auditPath: string;
  readonly slungStatePath: string;
}

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function testPaths(): Promise<TestPaths> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sling-dispatch-test-'));
  tmpDirs.push(dir);
  const auditPath = path.join(dir, 'events.jsonl');
  setAuditLogPath(auditPath);
  return {
    dir,
    auditPath,
    slungStatePath: path.join(dir, 'slung-state.json'),
  };
}

async function readAudit(pathToAudit: string): Promise<Record<string, unknown>[]> {
  const raw = await fs.readFile(pathToAudit, 'utf-8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function request(overrides: Partial<DecodedSlingRequest> = {}): DecodedSlingRequest {
  return {
    kind: 'pr',
    number: 47,
    html_url: 'https://github.com/gastownhall/gascity/pull/47',
    intent: 'triage',
    target: 'chief-of-staff',
    beadText: 'Please triage https://github.com/gastownhall/gascity/pull/47',
    ...overrides,
  };
}

function fakeSession(overrides: Partial<GcSession> & { id: string }): GcSession {
  return {
    template: 't',
    state: 'active',
    created_at: '2026-05-24T00:00:00Z',
    attached: false,
    ...overrides,
  } as GcSession;
}

describe('dispatchMaintainerSling', () => {
  test('success calls supervisor, audits, persists slung state, and notifies refresh', async () => {
    const paths = await testPaths();
    const calls: SlingInput[] = [];
    const notifications: unknown[] = [];
    const sling = async (input: SlingInput): Promise<SlingResponse> => {
      calls.push(input);
      return {
        status: 'ok',
        target: input.target,
        root_bead_id: 'gc-255139',
      };
    };

    const result = await dispatchMaintainerSling(request(), {
      repo: 'gastownhall/gascity',
      slungStatePath: paths.slungStatePath,
      sling,
      listSessions: async () => [
        fakeSession({
          id: 'gc-1',
          pool: 'chief-of-staff',
          session_name: 'oversight-rig__chief-of-staff',
        }),
      ],
      notifyRefresh: (payload) => notifications.push(payload),
    });

    assert.equal(result.beadId, 'gc-255139');
    assert.deepEqual(calls, [
      {
        target: 'chief-of-staff',
        bead: 'Please triage https://github.com/gastownhall/gascity/pull/47',
      },
    ]);

    const state = await readSlungState(paths.slungStatePath);
    const entry = state['pr:47'];
    assert.ok(entry);
    assert.equal(entry.target, 'chief-of-staff');
    assert.equal(entry.bead_id, 'gc-255139');
    assert.equal(entry.resolved_session_name, 'oversight-rig__chief-of-staff');

    assert.deepEqual(notifications, [{ computed_at: null, repo: 'gastownhall/gascity' }]);

    const [audit] = await readAudit(paths.auditPath);
    assert.equal(audit?.type, 'dashboard.sling');
    assert.equal(audit?.endpoint, 'POST /api/maintainer/sling');
    const parsed = audit?.parsed_args as Record<string, string>;
    assert.equal(parsed.kind, 'pr');
    assert.equal(parsed.number, '47');
    assert.equal(parsed.intent, 'triage');
    assert.equal(parsed.target, 'chief-of-staff');
    assert.equal(JSON.stringify(audit).includes('Please triage'), false);
  });

  test('failure audits and rethrows without writing slung state or notifying refresh', async () => {
    const paths = await testPaths();
    const notifications: unknown[] = [];
    const failure = new Error('gc supervisor returned 502');

    await assert.rejects(
      () =>
        dispatchMaintainerSling(request(), {
          repo: 'gastownhall/gascity',
          slungStatePath: paths.slungStatePath,
          sling: async () => {
            throw failure;
          },
          notifyRefresh: (payload) => notifications.push(payload),
        }),
      failure,
    );

    assert.deepEqual(await readSlungState(paths.slungStatePath), {});
    assert.deepEqual(notifications, []);

    const [audit] = await readAudit(paths.auditPath);
    assert.equal(audit?.type, 'dashboard.sling');
    const parsed = audit?.parsed_args as Record<string, string>;
    assert.equal(parsed.error_kind, 'upstream');
    assert.equal(JSON.stringify(audit).includes('gc supervisor returned'), false);
  });
});
