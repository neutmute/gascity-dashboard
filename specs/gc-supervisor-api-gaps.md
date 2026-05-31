# GC Supervisor API Gap Analysis For Future Dashboard Work

Date: 2026-05-31
Status: Consolidated from current architecture and remediation specs

## Purpose

This document is the single source of truth for Gas City supervisor API and
Gas City/shared presentation gaps that this dashboard should push upstream
into `gastownhall/gascity` before it becomes the future `gc dashboard`.

It is separate from `specs/feature-gap-analysis.md`: that file tracks features
present in the legacy built-in dashboard but missing from this standalone
dashboard. This file tracks upstream data/API capabilities needed so the
standalone dashboard can delete local derivation, temporary adapters, and broad
refresh behavior.

This repo should not patch `~/Code/gastownhall/gascity` as part of dashboard
work. When a gap below is hit, document it here, keep the dashboard behavior
explicit, and implement the upstream fix in the Gas City repo separately.

## Method

Sources consolidated:

- `specs/architecture/formula-run-detail-type.md`
- `specs/plans/code-quality-remediation-plan.md`
- archived run-detail planning notes under `specs/plans/archive/`
- current dashboard implementation constraints implied by generated supervisor
  client usage and Formula Run Detail projection

Validation rules:

- A gap only belongs here if fixing it requires Gas City supervisor API output,
  Gas City OpenAPI/Huma schema source, or a shared Gas City presentation
  package.
- Dashboard-only presentation, routing, styling, local git diff behavior, and
  frontend ergonomics stay out of this file.
- Existing `gc.*` metadata is treated as authoritative data. The gap is not
  "metadata is weak"; the gap is where the supervisor omits a canonical field,
  leaves a presentation shape empty, fails to attach identity to every event,
  or has an OpenAPI schema that does not match emitted payloads.

## Impact Scale

- **Critical** - Blocks deletion of dashboard-side adapters or causes current
  run detail to miss core identity/status.
- **High** - Forces local derivation or broad refresh for common formula-run
  inspection.
- **Medium** - Improves correctness, diagnostics, or future presentation
  ownership but has a current dashboard workaround.
- **Low** - Polish or cleanup once stronger upstream shapes exist.

## Executive Summary

The current dashboard can render useful Formula Run Detail views from today's
supervisor data. The worst remaining issues are not that `gc.*` metadata is
untrustworthy; it is that the supervisor does not yet expose a complete
view-model-grade run presentation shape, and its OpenAPI source still has a few
accuracy gaps relative to observed payloads.

Highest-impact upstream work:

1. Emit formula identity directly in run snapshots.
2. Populate canonical graph.v2 presentation fields, or provide a shared
   presentation package consumed by both Gas City and this dashboard.
3. Guarantee fresh rig-store runtime state through scoped bead reads or fresh
   scoped snapshots.
4. Attach canonical run/root identity to every run-affecting event.
5. Align Gas City Huma/OpenAPI source with actual emitted payloads so generated
   validators can be the only supervisor-shape authority.
6. Emit a GC-native worker heartbeat or per-entity progress/liveness signal for
   robust ambient staleness detection.

## Gap Matrix

| ID | Gap | Needed upstream capability | Impact | Why the dashboard needs it |
|----|-----|----------------------------|--------|-----------------------------|
| GC-1 | Formula identity in run snapshots | `WorkflowSnapshotResponse` should expose root `ref`, typed `formula_name`, `gc.formula`, or an equivalent canonical formula field. | **Critical** | Formula detail lookup should not fail when only the root bead `ref` knows the formula name. |
| GC-2 | Canonical graph.v2 presentation | Populate `logical_nodes`, `logical_edges`, and `scope_groups`, or ship a shared Gas City presentation package that owns semantic ids, display order, hidden-control collapsing, loop/retry grouping, and visible edges. | **High** | The dashboard should consume presentation semantics instead of deriving a local TypeScript view model from raw bead metadata. |
| GC-3 | Rig-store runtime freshness | Expose scoped rig-store bead reads through the supervisor, or guarantee that scoped run snapshots include current runtime state for non-city stores. | **High** | City-store runs can refresh bead status independently; rig-store runs are snapshot-bound. |
| GC-4 | Per-execution session identity | Attach canonical session id/name to every execution instance or node when a session exists. | **High** | Current metadata is usable when present, but absent session fields force assignee/name matching and can leave nodes unresolved. |
| GC-5 | Event identity on every run-affecting event | Every event that can affect a formula run should carry canonical `workflow_id`/`run_id`, `root_bead_id`, or equivalent identity in the envelope or nested payload metadata. | **High** | Identity-less events force broad refresh invalidation instead of precise run-detail refresh. |
| GC-6 | OpenAPI schema accuracy | Gas City Huma/OpenAPI source must match observed payloads: nullable `Bead.priority`; legacy bead fields such as `owner`, `updated_at`, `closed_at` if still emitted; phantom event fields such as `next`; and formula-detail degraded/missing responses. | **Critical** | The dashboard now uses generated SDK + generated Zod validators. Future schema refreshes must not re-break valid degraded payloads or require dashboard-side schema overlays. |
| GC-7 | Canonical execution-instance fields | Optionally expose execution instance id, semantic node id, loop iteration, retry attempt, current/historical flag, and attached session identity directly. | **Medium** | Existing metadata is enough for the current page, but canonical fields would delete projection code and remove field-precedence decisions from the dashboard. |
| GC-8 | GC-native heartbeat/progress signal | Emit worker heartbeat or per-entity progress/liveness metadata such as `metadata.gc.last_heartbeat_at`, plus events when useful. | **High** | Ambient stuck/stale detection currently has to infer from bead/session joins and progress monotonicity because `bead.updated_at` is noisy and there is no per-entity progress SSE. |
| GC-9 | Canonical formula-detail status in snapshots | Optionally include formula-detail availability/status on the run snapshot when formula detail cannot be fetched. | **Medium** | The dashboard currently models lookup failures locally. A supervisor-owned status would make diagnostics more consistent. |

## Gap Detail

### GC-1: Formula Identity In Run Snapshots

Current state:

- Some graph root beads expose `gc.formula_contract=graph.v2` but do not carry
  `gc.formula` or `gc.formula_name`.
- Gas City can recover a formula name from the root bead `ref` in other feed
  projections.
- `WorkflowSnapshotResponse` bead rows do not expose `ref`.

Needed upstream change:

- Add one canonical formula identity source to the run snapshot:
  root `ref`, typed `formula_name`, typed `formula_id`, `gc.formula`, or an
  equivalent field with stable semantics.

Why:

- Formula detail/preview ordering should be available from supervisor data.
- The dashboard should not parse formula files and should not guess a formula
  from titles.

### GC-2: Canonical Graph.v2 Presentation

Current state:

- Gas City emits authoritative graph.v2 metadata such as `gc.logical_bead_id`,
  `gc.step_ref`, `gc.scope_ref`, `gc.control_for`, `gc.iteration`,
  `gc.attempt`, and `gc.max_attempts`.
- The supervisor response also has presentation-shaped fields
  `logical_nodes`, `logical_edges`, and `scope_groups`, but they are empty
  today.
- The dashboard derives semantic nodes, visible edges, hidden-control badges,
  loop/retry grouping, current/historical visibility, and display statuses
  locally.

Needed upstream change:

- Populate `logical_nodes`, `logical_edges`, and `scope_groups` with the
  canonical graph.v2 display model, or publish a shared presentation package
  that this dashboard and Gas City can both consume.

Why:

- The dashboard should be a view over Gas City formula-run semantics, not a
  second presentation engine that can drift.

### GC-3: Rig-Store Runtime Freshness

Current state:

- City-store runs can refresh individual beads through city bead APIs.
- Rig-store runs cannot refresh the same way because the supervisor city bead
  endpoint does not expose scoped rig-store bead reads.
- For rig-store details, the embedded run snapshot is authoritative for that
  request but only as fresh as the snapshot.

Needed upstream change:

- Provide scoped rig-store bead reads, or make scoped run snapshots carry
  guaranteed-current runtime bead status.

Why:

- Running formula detail should update status reliably for rig-backed work
  without relying on stale embedded snapshot state.

### GC-4: Per-Execution Session Identity

Current state:

- Session resolution is robust when beads carry `session_id`,
  `session_name`, `gc.session_id`, `gc.session_name`, or t3bridge
  `gc.sessionName`.
- When those are absent, the dashboard falls back to assignee/name matching
  against session summaries and may surface `session_unresolved`.

Needed upstream change:

- Attach canonical session id/name to each execution instance or graph node
  whenever a session exists, including loop and retry executions.

Why:

- Selecting a node should deterministically open the right transcript without
  matching aliases or inferring from assignees.

### GC-5: Event Identity On Every Run-Affecting Event

Current state:

- Events with `workflow_id`, `run_id`, `root_bead_id`, or corresponding
  `gc.*` metadata can be filtered to one Formula Run Detail page.
- Events without identity remain broad invalidation signals.

Needed upstream change:

- Every event that can affect a run detail should carry canonical run/root
  identity in the envelope or nested payload.

Why:

- The dashboard can then refresh only affected runs and can eventually move
  toward backend-owned event reduction without broad invalidation.

### GC-6: OpenAPI Schema Accuracy

Current state:

- The dashboard generates a backend-only supervisor SDK, types, and Zod
  response validators from the committed OpenAPI.
- The committed dashboard schema has been corrected enough for current
  validators to run, but the upstream Gas City Huma/OpenAPI source still needs
  source-of-truth fixes.
- Temporary dashboard DTO normalization remains in `gc-supervisor-decoders.ts`
  until generated validators plus typed DTO mapping can replace it.

Needed upstream change:

- Fix the Gas City Huma/OpenAPI source for observed payload reality:
  `Bead.priority` is nullable in read responses; legacy bead fields such as
  `owner`, `updated_at`, and `closed_at` must either be modeled or removed from
  emitted payloads; phantom event fields such as `next` must match actual
  event payloads; formula-detail required fields must match degraded and
  missing-formula responses.

Why:

- Generated response validation should be the only supervisor-shape authority.
- Future `npm run openapi:gc-supervisor:update` refreshes must not reintroduce
  drift that forces dashboard-side schema patches.

### GC-7: Canonical Execution-Instance Fields

Current state:

- Existing metadata is enough to render the current Formula Run Detail page.
- The dashboard still decides field precedence for semantic node id, execution
  instance id, loop iteration, retry attempt, current/historical state, and
  attached session identity.

Needed upstream change:

- Optionally expose a canonical execution-instance projection on the snapshot
  or graph presentation shape.

Why:

- This would let the dashboard remove derivation code and render a stable
  upstream view model directly.

### GC-8: GC-Native Heartbeat/Progress Signal

Current state:

- The city event stream has discrete state-change events, but no per-entity
  progress event. SSE heartbeat is transport keep-alive, not work liveness.
- `bead.updated_at` is noisy because metadata rewrites update it even when
  a run is not making semantic progress.
- `session.last_active` is useful but only indirect: it reports tmux pane I/O,
  not formula-node progress.
- Archived observability planning identified a future Gas City heartbeat issue
  that would write `metadata.gc.last_heartbeat_at`.

Needed upstream change:

- Emit a canonical work-liveness signal, such as
  `metadata.gc.last_heartbeat_at` on active work, and expose it in supervisor
  snapshots and/or run-affecting events.

Why:

- Ambient "is this stuck?" UI should not depend permanently on bead/session
  joins, alias matching, or progress-monotonicity inference.
- Once this exists, the dashboard can demote its current staleness inference to
  fallback behavior and make concern signals more robust.

### GC-9: Canonical Formula-Detail Status

Current state:

- The dashboard uses `RunFormulaDetailState` to distinguish missing formula
  metadata, missing target, timeout, not-found, invalid payload, and upstream
  failures.

Needed upstream change:

- Optionally include formula-detail availability/status in the run snapshot
  when the supervisor already knows formula detail cannot be fetched.

Why:

- The dashboard can display supervisor-owned diagnostics instead of deriving
  them from follow-up route calls.

## Explicit Non-Gaps

These are intentionally not tracked as current GC supervisor API gaps:

- **`gc.*` metadata as a source.** Metadata such as `gc.logical_bead_id`,
  `gc.step_ref`, `gc.scope_ref`, `gc.control_for`, `gc.iteration`,
  `gc.attempt`, `gc.max_attempts`, `gc.run_target`, and identity fields is
  authoritative producer data. The gap is only where it is absent or where a
  canonical presentation shape would prevent duplicate dashboard projection.
- **Run/root identity when present.** Top-level supervisor fields and bead
  metadata can identify runs via `workflow_id`, `run_id`, and
  `root_bead_id`. Only identity-less events remain a gap.
- **Formula detail target selection.** The dashboard can use root-bead
  `gc.run_target`, `gc.routed_to`, or assignee. The remaining formula gap is
  identity exposure when only root `ref` knows the formula name.
- **Logical grouping metadata for the current page.** Current `gc.*` metadata
  is enough for the current dashboard view. The future gap is centralizing the
  canonical presentation in Gas City/shared code.
- **Local git diff evidence.** Diff rendering is dashboard-local evidence from
  the execution folder, not supervisor run state.
- **Current staleness inference.** The dashboard can infer likely stalled work
  from bead/session joins and progress monotonicity. That inference is useful
  today, but a native heartbeat/progress field would be the better upstream
  source of truth for future ambient status.

## Downstream Dashboard Cleanup Unblocked By These Gaps

Once these upstream gaps are closed and this repo refreshes
`backend/openapi/gc-supervisor.openapi.json`, the dashboard should:

1. Delete temporary hand-Zod supervisor adapters and any `SchemaOutputFor`
   machinery that duplicates generated response validation.
2. Move any remaining raw supervisor mirror types out of `shared`; keep
   `shared` for dashboard-owned `/api/*` DTOs only.
3. Replace local graph.v2 presentation derivation with canonical Gas City or
   shared presentation output.
4. Remove broad run-detail invalidation for identity-less events.
5. Remove session alias/assignee fallback paths once execution instances carry
   canonical session identity.
6. Demote bead/session staleness inference once a GC-native heartbeat/progress
   signal is available.
