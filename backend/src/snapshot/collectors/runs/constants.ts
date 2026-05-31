export const RUNS_CACHE_TTL_MS = 60 * 1000;
export const RUNS_FETCH_LIMIT = 1_000;
export const RECENT_RUN_FETCH_LIMIT = 80;

/**
 * gascity-dashboard-yh5i: active and historical lanes have independent caps
 * so complete lanes can never crowd active work out of the visible window.
 */
export const MAX_VISIBLE_ACTIVE_LANES = 8;
export const MAX_VISIBLE_HISTORICAL_LANES = 5;

export const RECENT_CHANGES_CAP = 12;
