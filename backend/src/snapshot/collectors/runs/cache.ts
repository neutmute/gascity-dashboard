import type { RunSummary } from 'gas-city-dashboard-shared';

import type { GcClient } from '../../../gc-client.js';
import { SourceCache } from '../../cache.js';
import { RUNS_CACHE_TTL_MS, RUNS_FETCH_LIMIT } from './constants.js';
import { loadRunBeads } from './discovery.js';
import { runBeadFilter } from './filter.js';
import { buildRunSummary } from './grouping.js';
import { fromGcBead } from '../phaseMapping.js';

export interface CreateRunsSourceCacheOptions {
  /** Live source for beads. Required unless `load` is injected directly. */
  gc?: GcClient | undefined;
  /** Per-call fetch cap. Defaults to RUNS_FETCH_LIMIT. */
  limit?: number | undefined;
  now?: (() => Date) | undefined;
  loadFixture?: (() => Promise<RunSummary> | RunSummary) | undefined;
  useFixture?: boolean | undefined;
  /** Test seam: override the loader entirely (bypasses gc + filter + adapter). */
  load?: (() => Promise<RunSummary> | RunSummary) | undefined;
}

export function createRunsSourceCache(
  options: CreateRunsSourceCacheOptions = {},
): SourceCache<RunSummary> {
  const load = options.load ?? buildDefaultLoad(options);

  return new SourceCache<RunSummary>({
    source: 'runs',
    ttlMs: RUNS_CACHE_TTL_MS,
    now: options.now,
    sanitizeErrorMessage: null,
    load,
    loadFixture: options.loadFixture,
    useFixture: options.useFixture,
  });
}

export function buildDefaultLoad(
  options: CreateRunsSourceCacheOptions,
): () => Promise<RunSummary> {
  const { gc } = options;
  if (!gc) {
    throw new Error(
      'createRunsSourceCache requires either { gc } or { load } (test seam).',
    );
  }
  const limit = options.limit ?? RUNS_FETCH_LIMIT;
  return async () => {
    const { beads, feedScopes, partial } = await loadRunBeads(gc, limit);
    const filtered = beads.filter(runBeadFilter);
    const adapted = filtered.map(fromGcBead);
    return buildRunSummary(adapted, feedScopes, partial);
  };
}
