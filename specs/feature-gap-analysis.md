# Feature Gap Analysis: Legacy `gc dashboard` to `gascity-dashboard`

Date: 2026-05-31
Status: Combined and source-validated from the Claude and Codex analyses

## Purpose

This document identifies features present in the dashboard built into
`~/Code/gastownhall/gascity` that are absent or materially narrower in this
standalone `gascity-dashboard` repo.

Upstream Gas City supervisor API and shared-presentation gaps are tracked
separately in [`gc-supervisor-api-gaps.md`](gc-supervisor-api-gaps.md). This
file is about dashboard product/UI parity, not changes that must be pushed
into the Gas City supervisor API.

The comparison is intentionally asymmetric: it is about what the built-in
`gc dashboard` can do today that the standalone dashboard cannot yet do. A
short non-gap section near the end captures important standalone-only
capabilities so that the gap list is not mistaken for an overall product
assessment.

## Method

Legacy source reviewed:

- `~/Code/gastownhall/gascity/cmd/gc/cmd_dashboard.go`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/index.html`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/src/api.ts`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/src/main.ts`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/src/palette.ts`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/src/panels/*.ts`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/src/state.ts`

Standalone source reviewed:

- `README.md`, `specs/requirements/product.md`, `DESIGN.md`
- `frontend/src/App.tsx`
- `frontend/src/CityBootstrap.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/routes/*`
- `backend/src/city/runtime.ts`
- `backend/src/routes/*`
- `backend/src/gc-client.ts`
- `shared/src/*`

Validation rules:

- A feature only counts as implemented when there is a user-reachable route,
  panel, control, or backend endpoint in the current source tree.
- Generated supervisor client types alone do not count as standalone dashboard
  functionality.
- Legacy helper files are not counted unless they are mounted by
  `index.html`/`main.ts` or reachable through a panel.
- Product vocabulary follows this repo: Formula, Run, Formula Run. Legacy
  `workflow` naming is treated as supervisor-edge vocabulary only.

## Impact Scale

- **Critical** - Missing from the primary operator loop; forces CLI/API fallback
  for common dispatch or work-management tasks.
- **High** - Blocks a major built-in-dashboard workflow or multi-city/operator
  control surface.
- **Medium** - Removes meaningful efficiency, situational awareness, or
  power-user ergonomics, but has an alternate path.
- **Low** - Convenience, polish, or diagnostics gap.

## Executive Summary

The standalone dashboard is stronger than the built-in dashboard for Formula
Run inspection, maintainer triage, cross-entity context, impersonated mailbox
reading, and the editorial/ambient product direction. The largest remaining
feature gaps are operational controls that the built-in dashboard exposes
directly against the supervisor API.

The root cause is architectural. The built-in dashboard calls a broad slice of
`/v0` supervisor endpoints directly from the browser. The standalone dashboard
uses a translating backend and currently exposes a deliberately smaller
mutation surface:

- `POST /api/beads/:id/claim`
- `POST /api/beads/:id/close`
- `POST /api/beads/:id/nudge`
- `POST /api/mail-send`
- `POST /api/snapshot/refresh`
- `POST /api/sessions/:id/peek`
- `POST /api/maintainer/sling`
- `POST /api/client-errors`

That backend choice is better for security, auditability, and vocabulary
control, but it means broad supervisor operations must be reintroduced
intentionally instead of inherited automatically.

Highest-impact gaps:

1. Generic bead creation/editing/reopen/assignment/sling.
2. Convoys.
3. Rig, service, escalation, assigned-work, and queue administration.
4. Supervisor/no-city fleet mode and `gc dashboard` launch integration.
5. Supervisor/city event timeline.
6. Mail reply/archive/read-state/all-traffic workflows.

## Validated Gap Matrix

| # | Category | Built-in `gc dashboard` capability | Standalone state | Impact | User impact |
|---|---|---|---|---|---|
| 1 | Launch and packaging | `gc dashboard` and `gc dashboard serve` start the static dashboard, auto-discover the supervisor API when possible, and accept `--api`/`--port`. | Standalone runs as npm workspaces with separate backend/frontend dev servers; it is not yet wired into `gc dashboard` launch or packaging. | **High** | Operators cannot use the existing CLI muscle memory or replacement path yet. |
| 2 | Supervisor/fleet scope | No-city mode shows supervisor-level state, managed city tabs, and disabled city-scoped actions until a city is selected. | Bare `/` redirects to the first known city; most app routes are city-scoped under `/city/:cityName`. | **High** | Multi-city operators lose the fleet overview and safe "no city selected" landing state. |
| 3 | Stopped-city guardrails | City tabs and panels distinguish stopped/error cities and disable city-scoped forms with explicit copy. | No equivalent stopped-city command-center state; failed city data appears through route errors/partial state instead. | **Medium** | Operators get less immediate guidance when a city is stopped or unavailable. |
| 4 | Convoys | Convoy list, detail, creation, progress breakdown, issue add/remove/check/close paths, and convoy status chips. | No convoy route, API client, backend route, or UI module. Existing references are incidental filtering/generated supervisor types, not user functionality. | **High** | Operators cannot coordinate grouped work from the dashboard. |
| 5 | Bead lifecycle | Create bead, close/reopen, set priority/labels, assign/reassign/unassign, sling to target, dependency/ready/blocked views, rig filters. | Bead list/detail/board/dependency graph exist, plus claim/close/nudge. No generic create, reopen, priority/label edit, generic assign, or generic sling. | **Critical** | The dashboard cannot manage the main work queue end to end. Operators must fall back to CLI/API for routine work changes. |
| 6 | Escalations, assigned work, queues | Admin panels show escalations, assigned work, and queues with acknowledge/resolve/reassign/unassign/clear controls. | No escalation, assigned-work admin, or queue administration views. | **High** | Urgent or stuck work cannot be triaged from the dashboard. |
| 7 | Rig/service operations | Services panel restarts services; Rigs panel suspend/resume/restart rigs and exposes status/action controls. | No service or rig admin routes/panels/endpoints in the standalone dashboard. | **High** | Operators cannot perform common operational recovery actions from the UI. |
| 8 | Agent/crew operations | Crew, rigged-agent, and pooled-agent panels separate agent populations, show pending interaction signals, provide attach-command copy, and expose log/transcript drawers with older-history loading. | Agents list/detail and session/run inspection exist, but the crew/rigged/pooled operational split, attach-copy affordance, pending-question surface, and back-paging drawer ergonomics are not present. | **Medium** | Agent supervision is more observational and less optimized for intervention. |
| 9 | Mail operations | Inbox plus all-traffic mode, open-thread/message flows, reply, archive, mark read/unread, compose, and recipient options. | Mail list/thread reading and send-new-mail exist. No all-traffic view, reply endpoint/control, archive, mark read, or mark unread. | **High** | Mail triage cannot be completed from the dashboard; operators can read and compose but not process threads. |
| 10 | Event activity timeline | Supervisor and city event timeline backed by `/v0/events` and `/v0/city/{city}/events`, with filtering and live refresh. | `/api/events/stream` exists as an SSE proxy for refreshing views, and `/activity` shows git/deploy activity, but there is no human-facing supervisor/city event console. | **High** | Operators lose the canonical chronological audit/debug view for city and supervisor events. |
| 11 | Command palette and raw inspectors | Keyboard/open-button command palette can open common forms and inspect raw supervisor/city JSON. | No command palette or raw inspector surface. | **Medium** | Power users lose fast navigation, action discovery, and live debugging shortcuts. |
| 12 | One-screen command center | Built-in dashboard keeps status, crew, activity, mail, beads, admin panels, convoys, and output in one dense page. | Standalone uses route-specific pages: Home, Agents, Beads, Runs, Mail, Activity, Health, Maintainer. | **Medium** | Cross-domain monitoring requires navigation instead of a single command-center scan. Some of this may be intentional product direction. |
| 13 | Status banner alerts | Status panel aggregates running agents, assigned/open work, convoy count, unread mail, stuck agents, stale assignments, high-priority issues, dead sessions, and partial API failure. | Standalone has health/concern surfaces but not the same always-visible operational alert banner. | **Medium** | Operators lose at-a-glance warnings for several urgent conditions. |
| 14 | Live connection/write feedback/output | Built-in UI exposes connection state, write toasts, and an output panel for command/action results. | Live indicators exist only in specific SSE-backed views; no global connection badge, global action toast system, or output panel equivalent. | **Low/Medium** | Reduced confidence after writes and fewer immediate diagnostics. |

## Category Detail

### 1. Launch, Scope, and Fleet

**Gap: CLI launch integration**

The built-in dashboard is part of the `gc` CLI. `gc dashboard` and
`gc dashboard serve` start the dashboard against the machine-wide supervisor
API, with API discovery and `--api`/`--port` overrides. The standalone repo has
dev/build scripts, but no replacement `gc dashboard` integration or packaged
static handoff yet.

User impact: operators cannot treat the standalone dashboard as a drop-in
replacement until launch, packaging, and API targeting are integrated.

**Gap: supervisor/no-city mode**

The built-in dashboard supports a no-city scope where it shows supervisor-level
state and managed city tabs. City-scoped controls are gated until a city is
selected. The standalone `CityBootstrap` redirects bare `/` to the first known
city and the app routes are city-oriented.

User impact: fleet operators lose the neutral supervisor landing page and must
reason from within one selected city.

**Gap: stopped-city guardrails**

The built-in dashboard explicitly handles stopped/error city tabs and disables
forms with state-specific copy. The standalone dashboard has normal error and
partial-data handling, but not the same stopped-city command-center mode.

User impact: a stopped city is less obvious as a distinct operational state.

### 2. Work Coordination: Beads and Convoys

**Gap: generic bead creation and mutation**

The built-in dashboard exposes the full operator lifecycle for work items:

- Create a bead.
- Close and reopen a bead.
- Change priority and labels.
- Assign, reassign, unassign, and sling.
- Filter by tab/status/rig.
- Inspect ready/blocked/dependency context.

The standalone dashboard has strong read-side work visibility: board/list,
details, dependency graph, claim, close, and nudge. It does not yet expose the
generic write operations needed to manage the queue.

User impact: this is the most severe gap because bead work is the central
operator workflow. Closing/claiming/nudging is not enough to run the queue.

**Gap: convoys**

The built-in dashboard has a dedicated convoy module with list, detail,
creation, progress, and issue membership controls. The standalone dashboard has
no convoy view or API path. Mentions of `convoy` in this repo are either
generated supervisor API surface, maintainer-topic classification, or bead-list
filtering to keep convoy tracker issues out of the generic bead list.

User impact: operators cannot plan or monitor grouped work in the dashboard.

**Gap: escalations, assigned work, and queues**

Legacy admin panels expose:

- Escalations with acknowledge, resolve, and reassign actions.
- Assigned work with unassign and clear-all controls.
- Queue panels for seeing pending work by queue/rig.

The standalone dashboard does not currently have equivalent views or mutation
routes.

User impact: incident response and work balancing remain outside the UI.

### 3. Operational Control: Agents, Rigs, and Services

**Gap: services and rigs administration**

The built-in dashboard includes service restart controls and rig
suspend/resume/restart controls. The standalone dashboard does not expose
services or rigs as first-class operational resources.

User impact: operators must leave the dashboard for common recovery and control
actions.

**Gap: crew/rigged/pooled operational split**

The built-in dashboard separates crew, rigged agents, and pooled agents. It also
surfaces pending states and provides attach-command copy affordances such as
`gc agent attach ...`.

The standalone dashboard has a more narrative Agents view and strong run/session
inspection, but it lacks the same operational grouping and attach affordances.

User impact: supervising a large live crew is slower, especially when the next
operator action is to attach or respond to a pending prompt.

**Partial gap: transcript/log ergonomics**

The standalone dashboard is stronger for Formula Run detail and selected session
context. The built-in dashboard is stronger for command-center transcript/log
drawers and older-history loading directly from the crew surface.

User impact: session-level investigation is available, but the fastest
intervention path from a dense crew panel is missing.

### 4. Mail

**Gap: processing mail, not just reading/sending**

The built-in mail panel supports inbox and all-traffic views, opening messages,
replying, archiving, marking read/unread, and composing. The standalone mail
surface supports listing/reading threads and sending new mail, with
impersonation support, but it does not expose reply/archive/read-state actions
or all-traffic mode.

User impact: the standalone dashboard can inspect and initiate mail, but it
cannot complete the triage loop.

### 5. Events and Observability

**Gap: supervisor/city event console**

The built-in dashboard has a human-facing Activity panel for supervisor and
city events. It uses `/v0/events` in supervisor scope and
`/v0/city/{cityName}/events` in city scope, with live updates and filters.

The standalone backend proxies city event streams for reactive view refreshes,
and the frontend uses those events for runs and other route updates. The
standalone `/activity` page, however, is a git/deploy activity view rather than
a supervisor event timeline.

User impact: operators lose the chronological event view used for debugging,
auditing, and answering "what just happened?"

**Gap: status banner and operational alert aggregation**

The built-in status panel aggregates live operational warnings such as unread
mail, stuck agents, stale assignments, high-priority issues, dead sessions,
convoy counts, and partial API unavailability. The standalone dashboard has
health and concern surfaces but not the same always-visible status strip.

User impact: urgent conditions require route-specific discovery instead of a
single scan.

### 6. Power-User and UX Affordances

**Gap: command palette**

The built-in dashboard command palette opens forms, executes common dashboard
commands, and shows raw JSON snapshots for supervisor/city resources. The
standalone dashboard has no keyboard palette or raw-resource inspector.

User impact: advanced operators lose fast command discovery and debugging
shortcuts.

**Gap: output panel, global connection state, and write feedback**

The built-in dashboard includes an output panel and global feedback for action
results. The standalone dashboard has localized loading/error states and some
SSE indicators, but not a global action result log or global live-connection
indicator.

User impact: write outcomes and connection confidence are less visible across
the app.

**Partial gap: one-screen density**

The built-in dashboard is a dense command center. The standalone dashboard is
route-based and intentionally more editorial/typographic. This is partly a
product/design decision, not necessarily a defect, but it remains a feature gap
for operators who rely on one-screen cross-domain monitoring.

User impact: slower scanning across agents, beads, mail, events, and admin
state.

## Non-Gaps and Standalone-Only Strengths

The standalone dashboard is not simply a subset. These areas are not legacy
feature gaps and should be preserved when adding parity:

- **Formula Run detail** with DAG, stage ladder, run git diff, evidence panels,
  selected session context, and scope slicing.
- **Formula Run list** and run-oriented vocabulary, instead of leaking legacy
  workflow terms through the main UI.
- **Maintainer triage module** with GitHub issue/PR tiers, clusters,
  contributor stats, and bulk sling workflows.
- **Beads kanban board and dependency graph** for read-side work visibility.
- **Operator impersonation** for viewing agent mailboxes.
- **Cross-entity links** across beads, PRs, issues, sessions, and runs.
- **Ambient home/concern region** and favicon hysteresis.
- **Backend translation layer** with local-only binding, CSRF/origin checks,
  audit logging, typed shared contracts, centralized supervisor decoding, and
  partial-data signaling.

## Recommended Sequencing

1. **P0: restore core operator control.** Add generic bead create/reopen/edit,
   assignment/unassignment, generic sling, rig/service controls,
   escalation/assigned/queue operations, and convoys.
2. **P0: restore supervisor observability and launch parity.** Add
   supervisor/no-city fleet mode, stopped-city guardrails, event timeline, and
   `gc dashboard` launch/packaging integration.
3. **P1: complete mail triage.** Add reply, archive, read/unread, and
   all-traffic views while preserving impersonation.
4. **P1: improve intervention ergonomics.** Add pending-question signals,
   attach-command copy, crew/rigged/pooled grouping, and transcript back-paging
   where it fits the standalone design.
5. **P2: restore power-user affordances.** Add a command palette, raw resource
   inspectors, global connection state, write toasts, and an output/action log.
6. **Product decision needed: one-screen density.** Decide whether the
   standalone dashboard should reproduce the legacy command-center layout or
   provide equivalent situational awareness through an ambient route-based
   design.

## Validation Notes and Corrections

- The legacy `ready.ts` helper was not treated as a standalone mounted panel.
  Ready/blocked capability is counted only where it is user-reachable through
  the bead work surfaces.
- The standalone repo contains generated supervisor client functions for many
  legacy endpoints, including convoys and mail archive/reply. Those generated
  functions are not counted as implemented dashboard features until routed
  through the backend and UI.
- Standalone `POST /api/maintainer/sling` is maintainer-specific. It does not
  close the gap for generic bead/admin sling workflows.
- Standalone `/activity` is a git/deploy activity route, not the legacy
  supervisor/city event timeline.
- The built-in dashboard's broader mutation surface is not automatically
  desirable in the standalone architecture. Each restored write should go
  through the translating backend with shared types, audit logging, CSRF/origin
  protection, and centralized supervisor decoding.
