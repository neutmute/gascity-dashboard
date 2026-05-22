import { Router } from 'express';
import type {
  ContributorStat,
  MaintainerTriage,
} from 'gas-city-dashboard-shared';
import { recordAudit } from '../audit.js';
import {
  AGENT_ALIAS_RE,
  ExecError,
  execGcSling as defaultExecGcSling,
} from '../exec.js';
import type { ExecResult } from '../exec.js';
import { fetchTriage } from '../maintainer/triage.js';
import { readCache, writeCache } from '../maintainer/storage.js';
import { addSseClient, notifyRefresh, removeSseClient } from '../maintainer/sse.js';
import {
  applyTriagedState,
  loadTriagedState,
  setTriaged,
  type TriagedKey,
} from '../maintainer/triaged-state.js';

const GH_LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const GH_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(issues|pull)\/\d+$/;
const MAX_URL_LEN = 2_048;
const BEAD_ID_RE = /\b(td-wisp-[a-z0-9]{3,12})\b/;
/** Cap on a single POST /triaged batch. Headroom for whole-tier select. */
const MAX_TRIAGED_BATCH = 1_000;

type SlingIntent = 'review' | 'draft' | 'triage';
type SlingKind = 'pr' | 'issue';

// /api/maintainer routes — read the cached triage envelope or refresh it
// from `gh`. The refresh is on-demand for dev; the nightly worker (bead
// ar9) will eventually drive cache writes on its own cadence.

interface MaintainerRouterOptions {
  repo: string;
  cachePath: string;
  /** Default `gc sling` target when the request omits one. From config. */
  slingTarget: string;
  /**
   * Absolute path to the per-item triaged-state JSON file
   * (gascity-dashboard-2ax). Spliced onto envelopes at read time so the
   * cache file stays free of mutable per-item state.
   */
  triagedStatePath: string;
  /**
   * Injected `gc sling` runner. Defaults to the real exec wrapper; tests
   * pass a stub. This DI is the new pattern for write-exec routers
   * (mailSendRouter is a candidate for the same retrofit later).
   */
  execGcSling?: (target: string, beadText: string) => Promise<ExecResult>;
}

export function maintainerRouter({
  repo,
  cachePath,
  slingTarget,
  triagedStatePath,
  execGcSling = defaultExecGcSling,
}: MaintainerRouterOptions): Router {
  const router = Router();

  router.get('/triage', async (_req, res) => {
    const cached = await readCache(cachePath);
    if (cached !== null) {
      await spliceTriagedState(cached, triagedStatePath);
      void recordAudit({
        type: 'dashboard.fetch',
        endpoint: 'GET /api/maintainer/triage',
        parsed_args: {
          repo,
          source: 'cache',
          items: String(countItems(cached)),
        },
        duration_ms: 0,
      });
      res.json(cached);
      return;
    }
    // No cache yet — synthesize an empty envelope so the page renders
    // calmly instead of erroring. The frontend already handles
    // computed_at=null + empty tiers as "enrichment not yet computed".
    const empty: MaintainerTriage = {
      computed_at: null,
      repo,
      tiers: [
        { tier: 'regression_breaking', clusters: [], unclustered: [] },
        { tier: 'regression', clusters: [], unclustered: [] },
        { tier: 'stability', clusters: [], unclustered: [] },
      ],
      totals: { issues_open: 0, prs_open: 0 },
    };
    void recordAudit({
      type: 'dashboard.fetch',
      endpoint: 'GET /api/maintainer/triage',
      parsed_args: { repo, source: 'empty', items: '0' },
      duration_ms: 0,
    });
    res.json(empty);
  });

  router.post('/refresh', async (_req, res) => {
    const start = Date.now();
    try {
      const envelope = await fetchTriage(repo);
      await writeCache(cachePath, envelope);
      // Splice AFTER writeCache so the cache file stays free of mutable
      // per-item state; the response carries the read-time view.
      await spliceTriagedState(envelope, triagedStatePath);
      notifyRefresh(envelope);
      void recordAudit({
        type: 'dashboard.fetch',
        endpoint: 'POST /api/maintainer/refresh',
        parsed_args: {
          repo,
          items: String(countItems(envelope)),
        },
        duration_ms: Date.now() - start,
      });
      res.json(envelope);
    } catch (err) {
      if (err instanceof ExecError) {
        const status =
          err.kind === 'validation' ? 400 : err.kind === 'timeout' ? 504 : 502;
        res.status(status).json({ error: err.message, kind: err.kind });
        return;
      }
      const msg = (err as Error).message;
      res
        .status(502)
        .json({ error: 'failed to refresh maintainer triage', kind: 'upstream', details: { message: msg } });
    }
  });

  router.get('/events', (req, res) => {
    // SSE stream — fires a 'refreshed' event each time the cache is
    // rewritten (manual button or nightly worker). Frontend refetches
    // /triage on receipt. csrfValidate exempts GET, so this still
    // lives in the same writeRouter as the rest of /api/maintainer.
    addSseClient(res);
    req.on('close', () => removeSseClient(res));
  });

  router.post('/triaged', async (req, res) => {
    const body = req.body as {
      items?: unknown;
      triaged?: unknown;
    };
    if (typeof body.triaged !== 'boolean') {
      res.status(400).json({ error: 'invalid triaged (boolean required)', kind: 'validation' });
      return;
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ error: 'items must be a non-empty array', kind: 'validation' });
      return;
    }
    if (body.items.length > MAX_TRIAGED_BATCH) {
      res
        .status(400)
        .json({ error: `items array exceeds ${MAX_TRIAGED_BATCH}`, kind: 'validation' });
      return;
    }
    const keys: TriagedKey[] = [];
    for (const raw of body.items) {
      if (typeof raw !== 'object' || raw === null) {
        res.status(400).json({ error: 'invalid item shape', kind: 'validation' });
        return;
      }
      const candidate = raw as { kind?: unknown; number?: unknown };
      if (candidate.kind !== 'pr' && candidate.kind !== 'issue') {
        res.status(400).json({ error: 'invalid item.kind (pr|issue)', kind: 'validation' });
        return;
      }
      if (
        typeof candidate.number !== 'number' ||
        !Number.isInteger(candidate.number) ||
        candidate.number < 1
      ) {
        res.status(400).json({ error: 'invalid item.number', kind: 'validation' });
        return;
      }
      keys.push({ kind: candidate.kind, number: candidate.number });
    }

    try {
      const result = await setTriaged(triagedStatePath, keys, body.triaged);
      // Notify any open EventSource listeners so other tabs refetch.
      // notifyRefresh only carries {computed_at, repo}; if no cache
      // exists yet, computed_at is null and the client still refetches.
      const cached = await readCache(cachePath);
      notifyRefresh({ computed_at: cached?.computed_at ?? null, repo });
      void recordAudit({
        type: 'dashboard.maintainer.triaged',
        endpoint: 'POST /api/maintainer/triaged',
        parsed_args: {
          count: String(result.updated.length),
          triaged: String(body.triaged),
        },
        duration_ms: 0,
      });
      res.json({ ok: true, updated: result.updated, count: result.updated.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message, kind: 'internal' });
    }
  });

  router.post('/sling', async (req, res) => {
    const body = req.body as {
      kind?: unknown;
      number?: unknown;
      html_url?: unknown;
      intent?: unknown;
      target?: unknown;
    };

    if (!isSlingKind(body.kind)) {
      res.status(400).json({ error: 'invalid kind (pr|issue)', kind: 'validation' });
      return;
    }
    if (!isSlingIntent(body.intent)) {
      res
        .status(400)
        .json({ error: 'invalid intent (review|draft|triage)', kind: 'validation' });
      return;
    }
    if (typeof body.number !== 'number' || !Number.isInteger(body.number) || body.number < 1) {
      res.status(400).json({ error: 'invalid number', kind: 'validation' });
      return;
    }
    if (
      typeof body.html_url !== 'string' ||
      body.html_url.length > MAX_URL_LEN
    ) {
      res.status(400).json({ error: 'invalid html_url', kind: 'validation' });
      return;
    }
    const urlMatch = GH_URL_RE.exec(body.html_url);
    if (urlMatch === null) {
      res.status(400).json({ error: 'invalid html_url', kind: 'validation' });
      return;
    }
    // Cross-check: kind='pr' must point at /pull/, kind='issue' at /issues/.
    // Closes the "review PR <issues/47>" semantic footgun.
    const urlPath = urlMatch[1];
    const expected = body.kind === 'pr' ? 'pull' : 'issues';
    if (urlPath !== expected) {
      res.status(400).json({ error: 'kind/html_url mismatch', kind: 'validation' });
      return;
    }
    let target = slingTarget;
    if (body.target !== undefined) {
      if (typeof body.target !== 'string' || !AGENT_ALIAS_RE.test(body.target)) {
        res.status(400).json({ error: 'invalid target alias', kind: 'validation' });
        return;
      }
      target = body.target;
    }

    const beadText = composeBeadText(body.intent, body.html_url);
    try {
      const result = await execGcSling(target, beadText);
      void recordAudit({
        type: 'dashboard.sling',
        endpoint: 'POST /api/maintainer/sling',
        parsed_args: {
          kind: body.kind,
          number: String(body.number),
          intent: body.intent,
          target,
          text_len: String(beadText.length),
        },
        exit_code: result.exitCode,
        duration_ms: result.durationMs,
      });
      if (result.exitCode !== 0) {
        res.status(502).json({
          error: `gc sling failed (${result.exitCode})`,
          kind: 'upstream',
          details: { stderr: result.stderr.slice(0, 1024) },
        });
        return;
      }
      const idMatch = BEAD_ID_RE.exec(result.stdout);
      res.json({ ok: true, bead_id: idMatch?.[1] });
    } catch (err) {
      if (err instanceof ExecError) {
        const status =
          err.kind === 'validation' ? 400 : err.kind === 'timeout' ? 504 : 502;
        res.status(status).json({ error: err.message, kind: err.kind });
        return;
      }
      res.status(500).json({ error: (err as Error).message, kind: 'internal' });
    }
  });

  router.get('/contributor/:login', async (req, res) => {
    const login = req.params.login;
    if (!GH_LOGIN_RE.test(login)) {
      res.status(400).json({ error: 'invalid login', kind: 'validation' });
      return;
    }
    const cached = await readCache(cachePath);
    if (cached === null) {
      res.status(404).json({ error: 'no triage cache yet', kind: 'not_found' });
      return;
    }
    // The same ContributorStat is sliced onto every item the author owns
    // in the envelope, so any item carrying this login has the answer.
    // Avoids a second source of truth.
    const stat = findContributor(cached, login);
    if (stat === null) {
      res.status(404).json({ error: 'contributor not in current envelope', kind: 'not_found' });
      return;
    }
    void recordAudit({
      type: 'dashboard.fetch',
      endpoint: 'GET /api/maintainer/contributor/:login',
      parsed_args: { login },
      duration_ms: 0,
    });
    res.json(stat);
  });

  return router;
}

function findContributor(envelope: MaintainerTriage, login: string): ContributorStat | null {
  for (const tier of envelope.tiers) {
    for (const item of [...tier.unclustered, ...tier.clusters.flatMap((c) => c.items)]) {
      if (item.author.login === login) return item.author;
    }
  }
  return null;
}

// ── Sling dispatch (gascity-dashboard-ib5) ───────────────────────────
//
// Composes a per-intent bead text from the request body, dispatches via
// `gc sling`, and audit-logs. The exec fn is DI'd through router options
// so tests can stub. Audit row records only metadata + lengths — never
// the rendered text body (events.jsonl noise control).

function isSlingIntent(v: unknown): v is SlingIntent {
  return v === 'review' || v === 'draft' || v === 'triage';
}

function isSlingKind(v: unknown): v is SlingKind {
  return v === 'pr' || v === 'issue';
}

function composeBeadText(intent: SlingIntent, htmlUrl: string): string {
  switch (intent) {
    case 'review':
      return `Please review PR ${htmlUrl}`;
    case 'draft':
      return `Please draft a PR addressing ${htmlUrl}`;
    case 'triage':
      return `Please triage ${htmlUrl}`;
  }
}

function countItems(envelope: MaintainerTriage): number {
  return envelope.tiers.reduce(
    (n, tier) =>
      n +
      tier.unclustered.length +
      tier.clusters.reduce((m, c) => m + c.items.length, 0),
    0,
  );
}

// Mutates the envelope in place so every TriageItem.triaged /
// triaged_at reflects the state file. Called at read time; the cache
// file on disk is left untouched. This is the architectural choice
// that lets POST /triaged write only the state file and never the
// cache — closing the race between maintainer toggles and the nightly
// worker rewriting the cache.
async function spliceTriagedState(
  envelope: MaintainerTriage,
  statePath: string,
): Promise<void> {
  const state = await loadTriagedState(statePath);
  for (const tier of envelope.tiers) {
    applyTriagedState(tier.unclustered, state);
    for (const cluster of tier.clusters) {
      applyTriagedState(cluster.items, state);
    }
  }
}
