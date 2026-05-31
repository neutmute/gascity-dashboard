import type { IsoTimestamp } from './gc-client-types.js';
import type { GcRequiredPartialList } from './lists.js';

/**
 * One entry from the supervisor's `/v0/city/<city>/formulas/feed` endpoint —
 * a cross-rig view of every formula run the supervisor knows about, including
 * runs whose root beads live in rig stores (which `/v0/city/<city>/beads`
 * does NOT return). The dashboard uses this to discover rig-stored formula
 * roots that listBeads alone would miss — see gascity-dashboard-ej9y. The
 * decoder maps the supervisor's `MonitorFeedItemResponse.workflow_id` to
 * dashboard `run_id`.
 */
export interface GcFormulaRun {
  id: string;
  /** Always `'formula'` for items in this feed. */
  type: string;
  /** Lifecycle status (e.g. `'pending'`, `'done'`). */
  status: string;
  /** Formula name (e.g. `'mol-focus-review'`). */
  title: string;
  scope_kind: 'city' | 'rig' | (string & {});
  scope_ref: string;
  /** Absolute workspace path the formula is operating on. */
  target: string;
  started_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  /** Formula run root bead id (decoded from supervisor `workflow_id`). */
  run_id?: string;
  root_bead_id?: string;
  /** e.g. `'rig:gascity'` — needed to discover which rig's bead store the
   *  run lives in for downstream listBeads queries. */
  root_store_ref?: string;
  attached_bead_id?: string;
  logical_bead_id?: string;
  bead_id?: string;
  store_ref?: string;
  detail_available?: boolean;
  run_detail_available?: boolean;
}

export type GcFormulaRunList = GcRequiredPartialList<GcFormulaRun>;

/** One entry from FormulaRunsResponse.recent_runs — minimal per-run summary. */
export interface GcFormulaRecentRun {
  /** Formula run root bead id (decoded from supervisor `workflow_id`). */
  run_id: string;
  /** Absolute workspace path the formula was operating on. */
  target: string;
  /** Lifecycle status (e.g. `'pending'`, `'in_progress'`, `'done'`). */
  status: string;
  started_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/**
 * Mirrors `GET /v0/city/<city>/formulas/{name}/runs` — recent runs for one
 * named formula. Distinct from `GcFormulaRunList` (the cross-formula
 * `/formulas/feed`) — this endpoint is keyed by formula name and is the
 * source-of-truth for a formula's own run history page.
 */
export interface GcFormulaRunsResponse {
  /** Formula name the run list was queried for. */
  formula: string;
  /** Total runs the supervisor knows about for this formula (may exceed
   *  `recent_runs.length` when `limit` is in effect). */
  run_count: number;
  /** Most-recent first; bounded by the `limit` query param. */
  recent_runs: GcFormulaRecentRun[];
  /** True when one or more backends failed during aggregation. Wire shape
   *  may carry `recent_runs: null` + `partial: true`; the decoder
   *  normalizes `recent_runs` to `[]` so consumers always have an array.
   *  Required (not optional) because the supervisor's OpenAPI declares
   *  `FormulaRunsResponse.partial` as required `boolean`. */
  partial: boolean;
  /** Human-readable errors from backends that failed during aggregation. */
  partial_errors?: readonly string[];
}

/**
 * Mirrors `GET /v0/city/<city>/orders/feed` — currently-active order runs
 * across the city. The supervisor reuses `MonitorFeedItemResponse` (the
 * same per-item shape as `formulas/feed`), so the dashboard reuses
 * `GcFormulaRun` for items — each item's `type` discriminates
 * (`'formula'` vs `'order'`) so consumers can filter when both feeds
 * surface mixed traffic.
 */
export type GcOrdersFeedResponse = GcRequiredPartialList<GcFormulaRun>;

/**
 * One entry from `OrderHistoryListBody.entries` — one historical run of a
 * scheduled/triggered order. Mirrors the supervisor's `OrderHistoryEntry`
 * schema. `duration_ms` / `exit_code` / `signal` are strings on the wire
 * (the supervisor formats numerics for downstream consumers); leave them
 * as-is rather than parse at the edge so the SSOT shape ⊆ supervisor
 * exactly.
 */
export interface GcOrderHistoryEntry {
  /** Root bead id for the order run; deep-link key for `/order/history/{bead_id}`. */
  bead_id: string;
  /** Order name (unscoped). */
  name: string;
  /** Scoped order name (e.g. `'city:check-mail'` or `'rig:gascity:check-mail'`). */
  scoped_name: string;
  created_at: IsoTimestamp;
  capture_output: boolean;
  has_output: boolean;
  /** `null` when the supervisor returns no labels (wire emits `null` rather
   *  than `[]`); the decoder preserves this — see partial-vs-empty
   *  semantics. */
  labels: readonly string[] | null;
  store_ref: string;
  duration_ms?: string;
  exit_code?: string;
  signal?: string;
  error?: string;
  rig?: string;
  wisp_root_id?: string;
}

/**
 * Mirrors `GET /v0/city/<city>/orders/history?scoped_name=<...>` — the full
 * history of one named order. The supervisor wraps the entries in a single
 * envelope. Unlike the other List* bodies in this surface, the supervisor's
 * `OrderHistoryListBody` does NOT carry `partial` / `partial_errors` /
 * `total` — surfacing only the entries array.
 */
export interface GcOrderHistoryList {
  entries: GcOrderHistoryEntry[];
}

/**
 * Mirrors `GET /v0/city/<city>/order/history/{bead_id}` — full detail for
 * one historical order run, including its captured output. The wire shape
 * is `OrderHistoryDetailResponse`. `output` is the captured stdout/stderr
 * concatenation as emitted by the supervisor.
 */
export interface GcOrderHistoryDetail {
  bead_id: string;
  store_ref: string;
  created_at: IsoTimestamp;
  /** `null` when the supervisor returns no labels (wire emits `null`); the
   *  decoder preserves this so consumers can distinguish "no labels" from
   *  "unknown". */
  labels: readonly string[] | null;
  output: string;
}
