# Spike finding: "agent awaiting human decision" signal

Exit artifact for the awaiting-decision feasibility spike in `prd_incorporate-tmai-amux-components.md`. Verified against committed repo artifacts on 2026-06-01.

## Verdict

**EXISTS in the supervisor API — as BOTH a REST snapshot field AND an SSE event — but the dashboard does NOT consume it.** The signal is the supervisor's **`PendingInteraction`** (tool-approval / prompt-for-input). It is dashboard-local work to surface it; **no upstream change is required for the per-session case.**

## Evidence (all in `backend/openapi/gc-supervisor.openapi.json` unless noted)

- **Wire shape** — `PendingInteraction` (:4607): `{ request_id (req), kind (req), prompt?, options?: string[]|null, metadata? }`.
- **REST snapshot** — `GET /v0/city/{cityName}/session/{id}/pending` (:23301) → `SessionPendingResponse` (:6016): `{ supported: bool, pending?: PendingInteraction }`.
- **Write-back** — `POST /v0/city/{cityName}/session/{id}/respond` (:23574) ← `SessionRespondInputBody`: `{ action (req), request_id?, text?, metadata? }`. This is the real target for the decision-gate's accept/decline POST.
- **SSE event** — the per-session stream `GET .../session/{id}/stream` (:23730) emits a `{ event: "pending", data: PendingInteraction }` variant (:23856).
- **Not a session state** — `SessionResponse.state` is a free-form string with no enum (:6197); session activity is only `idle`/`in-turn`. Awaiting-decision is a separate `pending` channel, not a state value.
- **Not on the city-wide stream** — `TypedEventStreamEnvelope` (:7298) lists ~50 city event types (`bead.*`, `session.crashed/idle_killed/...`); none is `pending`/`awaiting`/`decision`.

## Why the dashboard doesn't see it today

- The live-refresh hook subscribes only to `bead.` and `session.` prefixes (`shared/src/operator.ts` `GC_EVENT_PREFIX`) on the **city** stream (`/api/events/stream`, proxied verbatim by `backend/src/routes/events.ts`) — which does not carry `pending`. And `useGcEventRefresh` is refresh-only (reads `event.type`, refetches), not payload-carrying.
- The **per-session** stream that *does* carry `pending` is proxied verbatim (`backend/src/routes/session-stream.ts`), so frames reach the browser — but the sole consumer `frontend/src/hooks/useSessionStream.ts` recognizes only `turn`/`snapshot` (`parseStreamPayload`, useSessionStream.ts:158–177); a `pending` frame falls through to `{ kind: 'invalid' }` and degrades the stream.
- The `blocked` values in `shared/src/gc-beads.ts` (BeadStatus) and `shared/src/run-detail.ts` (RunNodeStatus) are **work-graph** blocked (dependency), unrelated to awaiting-human-input.

## Path to surface it

1. **Dashboard-owned, no upstream issue (basic case):** extend `useSessionStream`/`parseStreamPayload` to handle the `pending` variant (not `invalid`), and/or poll `GET .../session/{id}/pending`; render an editorial "awaiting decision" affordance; wire accept/decline to `POST .../respond`. The write-action constraint in the PRD maps directly: read `pending` over SSE → `POST .../respond` (carry `request_id`) → re-render from the next pushed resolution. The existing `request_id` is the idempotency key.
2. **Optional upstream `gc` ask (city-wide case only):** to flag *which* agents across the city are blocked on a human without opening one SSE per session, the supervisor would need to emit a city-stream event (e.g. `session.pending` carrying `{session_id, request_id, kind}`) in `TypedEventStreamEnvelope`. That — and only that — is a legitimate `gastownhall/gascity` request.

## RFC-target adjudication (corrects the premortem)

The premortem's "RFC drafts target demo-dash" claim is **TRUE** for all four `.claude/rfc-drafts/` files (each is `gh issue create --repo gastownhall/demo-dash`). But its implication that those RFCs cover the decision signal is **FALSE** — they concern aimux **vendor quota** (rfc-1), tokscale **token windows** (rfc-2), and two dashboard-alignment discussions (rfc-3, rfc-4). **None addresses awaiting-human-decision.** This signal needs no demo-dash change and (per above) no `gc` change for the per-session case.
