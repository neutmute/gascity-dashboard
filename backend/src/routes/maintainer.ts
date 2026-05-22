import { Router } from 'express';
import type { ContributorStat, MaintainerTriage } from 'gas-city-dashboard-shared';
import { recordAudit } from '../audit.js';
import { ExecError } from '../exec.js';
import { fetchTriage } from '../maintainer/triage.js';
import { readCache, writeCache } from '../maintainer/storage.js';
import { addSseClient, notifyRefresh, removeSseClient } from '../maintainer/sse.js';

const GH_LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

// /api/maintainer routes — read the cached triage envelope or refresh it
// from `gh`. The refresh is on-demand for dev; the nightly worker (bead
// ar9) will eventually drive cache writes on its own cadence.

interface MaintainerRouterOptions {
  repo: string;
  cachePath: string;
}

export function maintainerRouter({ repo, cachePath }: MaintainerRouterOptions): Router {
  const router = Router();

  router.get('/triage', async (_req, res) => {
    const cached = await readCache(cachePath);
    if (cached !== null) {
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

function countItems(envelope: MaintainerTriage): number {
  return envelope.tiers.reduce(
    (n, tier) =>
      n +
      tier.unclustered.length +
      tier.clusters.reduce((m, c) => m + c.items.length, 0),
    0,
  );
}
