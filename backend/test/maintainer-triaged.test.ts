import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { MaintainerTriage, TriageItem } from 'gas-city-dashboard-shared';
import { maintainerRouter } from '../src/routes/maintainer.js';
import { setAuditLogPath } from '../src/audit.js';
import { writeCache } from '../src/maintainer/storage.js';

// Tests for POST /api/maintainer/triaged + envelope splice on GET /triage
// (gascity-dashboard-2ax).
//
// State persists in a separate JSON file from the maintainer cache so it
// survives nightly cache rewrites. The route handler splices state onto
// the cached envelope on every read; the cache file itself never holds
// triaged flags.

interface AppHandle {
  url: string;
  close: () => Promise<void>;
  auditPath: string;
  statePath: string;
  cachePath: string;
}

async function buildApp(): Promise<AppHandle> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'triaged-test-'));
  const auditPath = path.join(tmpDir, 'events.jsonl');
  const statePath = path.join(tmpDir, 'triaged-state.json');
  const cachePath = path.join(tmpDir, 'cache.json');
  setAuditLogPath(auditPath);

  const app = express();
  app.use(express.json());
  app.use(
    '/api/maintainer',
    maintainerRouter({
      repo: 'gastownhall/gascity',
      cachePath,
      slingTarget: 'mayor',
      triagedStatePath: statePath,
      execGcSling: async () => ({
        exitCode: 0,
        stdout: '',
        stderr: '',
        truncated: false,
        durationMs: 0,
      }),
    }),
  );

  return new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        auditPath,
        statePath,
        cachePath,
        close: () =>
          new Promise<void>((r) =>
            srv.close(async () => {
              await fs.rm(tmpDir, { recursive: true, force: true });
              r();
            }),
          ),
      });
    });
  });
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: data };
}

async function getJson(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url);
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: data };
}

async function readAudit(p: string): Promise<Array<Record<string, unknown>>> {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return raw.split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function makeItem(
  overrides: Partial<TriageItem> & Pick<TriageItem, 'kind' | 'number'>,
): TriageItem {
  return {
    kind: overrides.kind,
    number: overrides.number,
    title: overrides.title ?? `item ${overrides.number}`,
    status: overrides.status ?? 'open',
    author: overrides.author ?? {
      login: 'octocat',
      tier: 'regular',
      issues_accepted: null,
      issues_opened: null,
      prs_merged: null,
      prs_opened: null,
      computed_at: null,
    },
    created_at: overrides.created_at ?? '2026-05-20T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-05-21T00:00:00Z',
    labels: overrides.labels ?? [],
    tier: overrides.tier ?? 'stability',
    triage_score: overrides.triage_score ?? 0,
    cluster_id: overrides.cluster_id ?? null,
    blast_files: overrides.blast_files ?? [],
    lines_changed: overrides.lines_changed ?? null,
    weak_ties: overrides.weak_ties ?? [],
    linked_numbers: overrides.linked_numbers ?? [],
    html_url:
      overrides.html_url ??
      `https://github.com/gastownhall/gascity/${overrides.kind === 'pr' ? 'pull' : 'issues'}/${overrides.number}`,
    is_marked: overrides.is_marked ?? false,
    // `triaged` defaults to `true` here on purpose: tests seed the cache
    // with "lying" data so they can prove the route handler's splice at
    // read time uses the state file as the source of truth — not the
    // value baked into the cache.
    triaged: overrides.triaged ?? true,
    triaged_at: overrides.triaged_at ?? '1970-01-01T00:00:00.000Z',
  };
}

async function seedCacheWith(
  cachePath: string,
  items: TriageItem[],
): Promise<void> {
  const envelope: MaintainerTriage = {
    computed_at: '2026-05-22T00:00:00Z',
    repo: 'gastownhall/gascity',
    tiers: [
      { tier: 'regression_breaking', clusters: [], unclustered: [] },
      { tier: 'regression', clusters: [], unclustered: [] },
      { tier: 'stability', clusters: [], unclustered: items },
    ],
    totals: {
      issues_open: items.filter((i) => i.kind === 'issue').length,
      prs_open: items.filter((i) => i.kind === 'pr').length,
    },
  };
  await writeCache(cachePath, envelope);
}

function flattenItems(env: MaintainerTriage): TriageItem[] {
  const out: TriageItem[] = [];
  for (const tier of env.tiers) {
    out.push(...tier.unclustered);
    for (const c of tier.clusters) out.push(...c.items);
  }
  return out;
}

describe('POST /api/maintainer/triaged', { concurrency: false }, () => {
  let h: AppHandle;
  afterEach(async () => {
    if (h !== undefined) await h.close();
  });

  test('happy path: flips one item, persists, returns updated array', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ kind: 'pr', number: 47 }],
      triaged: true,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const updated = res.body.updated as Array<{ kind: string; number: number }>;
    assert.equal(updated.length, 1);
    assert.equal(res.body.count, updated.length);
    assert.equal(updated[0]!.kind, 'pr');
    assert.equal(updated[0]!.number, 47);

    const stateRaw = await fs.readFile(h.statePath, 'utf-8');
    const state = JSON.parse(stateRaw) as Record<string, { triaged_at: string }>;
    assert.ok(state['pr:47']?.triaged_at);
  });

  test('flips many items in one call (count === updated.length)', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [
        { kind: 'pr', number: 47 },
        { kind: 'issue', number: 12 },
      ],
      triaged: true,
    });
    assert.equal(res.status, 200);
    const updated = res.body.updated as Array<{ kind: string; number: number }>;
    assert.equal(updated.length, 2);
    assert.equal(res.body.count, updated.length, 'count must equal updated.length (0nn contract)');
    // Updated array preserves request order and shape.
    assert.deepEqual(updated, [
      { kind: 'pr', number: 47 },
      { kind: 'issue', number: 12 },
    ]);
  });

  test('flip back to false removes entry', async () => {
    h = await buildApp();
    await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ kind: 'pr', number: 47 }],
      triaged: true,
    });
    const off = await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ kind: 'pr', number: 47 }],
      triaged: false,
    });
    assert.equal(off.status, 200);
    const stateRaw = await fs.readFile(h.statePath, 'utf-8');
    const state = JSON.parse(stateRaw) as Record<string, unknown>;
    assert.equal(state['pr:47'], undefined);
  });

  test('writes an audit row of type dashboard.maintainer.triaged', async () => {
    h = await buildApp();
    await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ kind: 'pr', number: 47 }],
      triaged: true,
    });
    const rows = await readAudit(h.auditPath);
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.type, 'dashboard.maintainer.triaged');
    assert.equal(row.endpoint, 'POST /api/maintainer/triaged');
    assert.equal(row.actor, 'stephanie');
    const args = row.parsed_args as Record<string, string>;
    assert.equal(args.count, '1');
    assert.equal(args.triaged, 'true');
  });

  test('rejects invalid item shape (missing kind)', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ number: 47 }],
      triaged: true,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
  });

  test('rejects invalid kind value', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ kind: 'epic', number: 47 }],
      triaged: true,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
  });

  test('rejects non-integer number', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ kind: 'pr', number: 1.5 }],
      triaged: true,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
  });

  test('rejects non-boolean triaged', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ kind: 'pr', number: 1 }],
      triaged: 'yes',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
  });

  test('rejects empty items array', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [],
      triaged: true,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
  });

  test('fires SSE refreshed event so open tabs repaint (0nn dependency)', async () => {
    h = await buildApp();
    // Open an SSE listener BEFORE the POST.
    const eventsResp = await fetch(`${h.url}/api/maintainer/events`, {
      headers: { Accept: 'text/event-stream' },
    });
    assert.equal(eventsResp.status, 200);
    const reader = eventsResp.body!.getReader();
    const decoder = new TextDecoder();
    let acc = '';
    let sawRefresh = false;
    const readUntilRefresh = (async () => {
      while (!sawRefresh) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (acc.includes('event: refreshed')) {
          sawRefresh = true;
          break;
        }
      }
    })();

    // Toggle one item.
    await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ kind: 'pr', number: 47 }],
      triaged: true,
    });

    // Bound the wait — we expect the event within a tick.
    await Promise.race([
      readUntilRefresh,
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
    await reader.cancel();
    assert.ok(sawRefresh, 'POST /triaged should fire SSE refreshed event');
  });

  test('rejects oversized items array (>1000)', async () => {
    h = await buildApp();
    const items = Array.from({ length: 1001 }, (_, i) => ({ kind: 'pr', number: i + 1 }));
    const res = await postJson(`${h.url}/api/maintainer/triaged`, {
      items,
      triaged: true,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
  });
});

describe('GET /api/maintainer/triage with state splice', { concurrency: false }, () => {
  let h: AppHandle;
  afterEach(async () => {
    if (h !== undefined) await h.close();
  });

  test('state file overrides cache values at read time (splice point)', async () => {
    // makeItem seeds cache with triaged=true + ancient triaged_at.
    // If the route's GET returns the cache value verbatim, both items
    // come back triaged=true. The state file (empty initially) is the
    // authoritative source; this proves the splice OVERRIDES whatever
    // is in the cache, instead of preserving it.
    h = await buildApp();
    await seedCacheWith(h.cachePath, [
      makeItem({ kind: 'pr', number: 47 }),
      makeItem({ kind: 'issue', number: 12 }),
    ]);
    const res = await getJson(`${h.url}/api/maintainer/triage`);
    assert.equal(res.status, 200);
    const env = res.body as unknown as MaintainerTriage;
    const items = flattenItems(env);
    const pr47 = items.find((i) => i.kind === 'pr' && i.number === 47);
    const issue12 = items.find((i) => i.kind === 'issue' && i.number === 12);
    assert.ok(pr47 && issue12);
    assert.equal(pr47!.triaged, false, 'state file (empty) wins over cache value');
    assert.equal(pr47!.triaged_at, null);
    assert.equal(issue12!.triaged, false);
    assert.equal(issue12!.triaged_at, null);
  });

  test('state file applied to items: POST + GET round-trip', async () => {
    h = await buildApp();
    await seedCacheWith(h.cachePath, [
      makeItem({ kind: 'pr', number: 47 }),
      makeItem({ kind: 'issue', number: 12 }),
    ]);
    await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ kind: 'pr', number: 47 }],
      triaged: true,
    });
    const res = await getJson(`${h.url}/api/maintainer/triage`);
    const env = res.body as unknown as MaintainerTriage;
    const items = flattenItems(env);
    const pr47 = items.find((i) => i.kind === 'pr' && i.number === 47);
    const issue12 = items.find((i) => i.kind === 'issue' && i.number === 12);
    assert.equal(pr47!.triaged, true);
    assert.ok(pr47!.triaged_at);
    assert.notEqual(
      pr47!.triaged_at,
      '1970-01-01T00:00:00.000Z',
      'splice must use state file timestamp, not cache value',
    );
    assert.equal(issue12!.triaged, false);
    assert.equal(issue12!.triaged_at, null);
  });

  test('cache file untouched by POST /triaged (writes only state file)', async () => {
    h = await buildApp();
    await seedCacheWith(h.cachePath, [makeItem({ kind: 'pr', number: 47 })]);
    const before = await fs.readFile(h.cachePath, 'utf-8');
    await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ kind: 'pr', number: 47 }],
      triaged: true,
    });
    const after = await fs.readFile(h.cachePath, 'utf-8');
    assert.equal(after, before, 'cache file byte-identical after toggle');
  });

  test('triaged state survives a cache rewrite (nightly worker simulation)', async () => {
    h = await buildApp();
    await seedCacheWith(h.cachePath, [makeItem({ kind: 'pr', number: 47 })]);
    await postJson(`${h.url}/api/maintainer/triaged`, {
      items: [{ kind: 'pr', number: 47 }],
      triaged: true,
    });

    // Simulate nightly refresh: overwrite the cache file with a fresh
    // envelope (no triaged flags — that's the entire point of splitting
    // state out).
    await seedCacheWith(h.cachePath, [
      makeItem({ kind: 'pr', number: 47, title: 'updated title' }),
    ]);

    const res = await getJson(`${h.url}/api/maintainer/triage`);
    const env = res.body as unknown as MaintainerTriage;
    const items = flattenItems(env);
    const pr47 = items.find((i) => i.kind === 'pr' && i.number === 47);
    assert.ok(pr47);
    assert.equal(pr47!.title, 'updated title');
    assert.equal(pr47!.triaged, true, 'triaged survived cache rewrite');
    assert.ok(pr47!.triaged_at);
  });
});
