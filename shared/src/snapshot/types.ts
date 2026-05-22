// Read-side telemetry envelope shared across the snapshot series
// (gascity-dashboard-37u). Ported from demo-dash src/shared/types.ts.
//
// The SourceName union enumerates every source the dashboard may surface;
// individual collectors are wired in later beads. Listing all six names
// here even though only city/workflows/resources have collectors today
// keeps DashboardSources (bead-3) and the fixture JSON (bead-2) able to
// `satisfies` a fully-keyed object without churn when the remaining
// collectors land.

export type SourceName =
  | 'aimux'
  | 'city'
  | 'resources'
  | 'workflows'
  | 'github'
  | 'tokens';

export type SourceStatus = 'fresh' | 'stale' | 'error' | 'fixture';

export interface SourceState<T> {
  source: SourceName;
  status: SourceStatus;
  fetchedAt: string | null;
  staleAt: string | null;
  error: string | null;
  data: T | null;
}
