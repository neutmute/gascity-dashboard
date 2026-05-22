import { ExecError } from '../exec.js';
import { fetchTriage } from './triage.js';
import { writeCache } from './storage.js';
import { notifyRefresh, sendHeartbeat } from './sse.js';

// Nightly enrichment worker (gascity-dashboard-ar9). In-process setInterval
// scheduler — no external cron. Runs once at boot (after a short delay so
// the HTTP server is listening first) and then on the configured cadence.
// On every successful pass: rewrite the cache, notify connected SSE
// clients, log a single line. On error: log + continue, never crash the
// backend.
//
// Heartbeats keep open EventSource connections from getting timed out
// by intermediaries — fired every 30s independent of the refresh
// cadence.

const HEARTBEAT_INTERVAL_MS = 30_000;
const STARTUP_DELAY_MS = 5_000;

export interface WorkerOptions {
  repo: string;
  cachePath: string;
  intervalMs: number;
}

let refreshTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

export function startMaintainerRefresher(opts: WorkerOptions): void {
  if (refreshTimer !== null) {
    // Already running. Safe-noop so a re-call during dev hot reload
    // doesn't accumulate intervals.
    return;
  }

  // Heartbeat tick — independent of the refresh schedule.
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  // Kick off an initial refresh shortly after boot. .unref() so the
  // backend can shut down cleanly while the timer is still in-flight.
  setTimeout(() => {
    void runRefresh(opts);
  }, STARTUP_DELAY_MS).unref();

  refreshTimer = setInterval(() => {
    void runRefresh(opts);
  }, opts.intervalMs);
  refreshTimer.unref();

  console.log(
    `[maintainer] refresher started for ${opts.repo}, interval ${formatInterval(opts.intervalMs)}`,
  );
}

async function runRefresh(opts: WorkerOptions): Promise<void> {
  const start = Date.now();
  try {
    const envelope = await fetchTriage(opts.repo);
    await writeCache(opts.cachePath, envelope);
    notifyRefresh(envelope);
    const issues = envelope.totals.issues_open;
    const prs = envelope.totals.prs_open;
    console.log(
      `[maintainer] refresh ok: ${issues} issues, ${prs} PRs in ${Date.now() - start}ms`,
    );
  } catch (err) {
    const msg = err instanceof ExecError ? err.message : (err as Error).message;
    console.error(`[maintainer] refresh failed: ${msg}`);
  }
}

function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}
