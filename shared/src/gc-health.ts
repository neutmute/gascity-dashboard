import type { IsoTimestamp } from './gc-client-types.js';
import type { Avail } from './lists.js';

export interface SystemHealth {
  /** Backend process state — totally local to the admin dashboard's node process. */
  admin: {
    pid: number;
    uptime_sec: number;
    rss_bytes: number;
    heap_used_bytes: number;
    node_version: string;
  };
  /** Machine-level state from Node's os module. */
  host: {
    load_avg_1: number;
    load_avg_5: number;
    load_avg_15: number;
    total_mem_bytes: number;
    free_mem_bytes: number;
    /** Number of logical CPUs. */
    cpu_count: number;
    uptime_sec: number;
  };
  /** gc supervisor's own city health probe. */
  supervisor: SupervisorHealthState;
}

export interface SupervisorHealth {
  status: string;
  /** Supervisor version. Optional per the supervisor's OpenAPI; present in
   *  practice today. Absence is itself a wire-drift signal — surface it
   *  rather than coalescing silently. */
  version?: string;
  /** City name. Optional per the supervisor's OpenAPI; present in practice
   *  today. Absence is itself a wire-drift signal — surface it rather than
   *  coalescing silently. */
  city?: string;
  uptime_sec: number;
}

export type SupervisorHealthState = Avail<{ data: SupervisorHealth }>;

/**
 * Dolt store on-disk health, as reported under `store_health` by the
 * supervisor's `GET /v0/city/{name}/status`. `size_bytes` is the
 * dolt-noms on-disk size the dashboard samples for its trend; the other
 * fields are surfaced for completeness (single source of truth) but are
 * not consumed dashboard-side yet. The whole block is optional because a
 * degraded supervisor may omit it.
 */
export interface StatusStoreHealth {
  size_bytes: number;
  live_rows?: number;
  ratio_mb_per_row?: number;
  last_gc_at?: IsoTimestamp;
}

/** `GET /v0/city/{name}/status` — only the fields the dashboard reads. */
export interface GcStatus {
  store_health?: StatusStoreHealth;
}

export interface DoltNomsSample {
  ts: IsoTimestamp;
  bytes: number;
}

export type DoltNomsUnavailableReason =
  | 'store_health_absent'
  | 'sample_failed';

export type DoltNomsTrend =
  | {
    available: true;
    /** Up to 144 samples (24 h at 10-min cadence). */
    samples: DoltNomsSample[];
    source: string;
  }
  | {
    available: false;
    /** Historical samples, if the source became unavailable after sampling. */
    samples: DoltNomsSample[];
    reason: DoltNomsUnavailableReason;
  };
