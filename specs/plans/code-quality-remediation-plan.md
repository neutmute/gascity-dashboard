# Code Quality Remediation Plan

Status: implementation in progress. WS-1 through WS-9 and WS-11 through WS-14 are complete in the current branch; WS-10 has generated transport, generated types, generated Zod response validation, generated-client drift checking, and strict type/lint coverage in place. The remaining WS-10 work is ownership cleanup: land the documented upstream GC supervisor API gaps, then delete the temporary hand-Zod DTO adapter/`SchemaOutputFor` machinery and move any remaining raw supervisor mirrors out of `shared`. This plan is the synthesis of two independent review passes against `main` (clean working tree, ~31k LOC of non-test source):

1. **Thermo-nuclear review (TN)** — 8 parallel slice reviewers auditing the whole codebase for abstraction quality, god-files, spaghetti growth, and canonical-helper drift.
2. **Codex remediation prompt (claims A–H)** — validated claim-by-claim against the actual source by 8 verifier agents. Each verdict below carries file:line evidence.

Every item in this plan is **evidence-backed and validated**. Where the two passes overlap they are merged; where Codex was imprecise the correction is called out.

The open decisions were resolved in a `/grill-me` session against the architecture specs and the upstream `gascity` dashboard as a reference (`~/code/gastownhall/gascity/cmd/gc/dashboard/web`), then tightened by the explicit product directives that this app has **no backwards-compatibility obligation** to old dashboard routes or backend DTOs and that the GC supervisor API client should be **generated from OpenAPI as completely as the tooling allows**. See **Resolved decisions** at the end; the affected workstreams (WS-1, WS-2, WS-10, WS-12) reflect the final calls.

## Guardrails (non-negotiable)

These bound every workstream. They come from `AGENTS.md`, the architecture-best-practices block in `CLAUDE.md`, and the Codex prompt.

- **Product language is Formula / Run / Formula Run.** `workflow` may remain where it is literally the GC supervisor wire contract, generated supervisor type vocabulary, Gas City graph metadata, a literal metadata key such as `pr_review.workflow_formula`, GitHub Actions naming, or archived historical planning material. Translate at the dashboard edge; never let `workflow` flow into dashboard-owned DTOs, routes, components, tests, scripts, or CSS.
- **Move-fast-and-break-it.** No legacy redirects, no backward-compat shims, no deprecation aliases unless the GC supervisor wire API itself requires them. The dashboard frontend is the only consumer of this backend service, so `/api/*` DTOs and browser routes may break and rename as needed.
- **Generate the GC supervisor client as completely as possible.** Endpoint paths, request/response types, SDK calls, and runtime response validators should come from OpenAPI generation. The only hand-written code left at that boundary should be dashboard policy a generator cannot express: coalescing, redaction, timeout/output-cap plumbing, same-origin SSE proxying, and explicit dashboard DTO mapping. Do not preserve duplicate hand-written endpoint maps, path builders, response mirrors, schema extractors, or validators once generated equivalents exist.
- **Do not hand-edit generated code.** Change OpenAPI inputs / generator config / source modules and regenerate.
- **TDD.** Write or update the test first (or alongside). A change is not done until red→green. Static warnings count as failures.
- **Behavior-preserving by default except where breakage is intentional.** WS-1 intentionally turns old dashboard routes into 404s; WS-2/WS-10 intentionally break dashboard-owned DTO names at the translation edge instead of aliasing old names; WS-12 intentionally changes run-detail interaction behavior; WS-13 intentionally surfaces previously-hidden failures. Everything else should preserve behavior while deleting drift.
- **Match CI locally before pushing:** run the CI-equivalent gate in this plan, including shared tests and generated-supervisor drift checks. A `shared` dashboard DTO change breaks `*.test.ts(x)` fixtures the app typecheck never sees.

## Validation summary

| Claim | Title | Verdict | Disposition | Workstream |
| --- | --- | --- | --- | --- |
| A | `/workflows` + `/kanban` redirects exist; delete them | **partial** (redirects exist `App.tsx:80-84`; spec already forbids them; safe to delete) | include as-stated | WS-1 |
| B | Dashboard-owned `workflow` types/fields → run vocab | **confirmed** | include as-stated | WS-2 |
| C | Formula identity resolution duplicated 6× | **confirmed** (some divergence is *intentional*) | include **modified** | WS-5 |
| D | Run scope parsed in 5 places; 1 true duplicate | **confirmed** | include as-stated | WS-6 |
| E | `snapshot/collectors/runs.ts` (878 LOC) does too much | **confirmed** | include **modified** (after C, D) | WS-8 |
| F | Supervisor schema authority split; write-edge casts | **confirmed** | **redesigned** → generate client+Zod from OpenAPI (`@hey-api`); see WS-10 | WS-10 |
| G | Split detail/diff resources; honest diff errors; decouple tab | **confirmed** | **accepted in full** (split hooks + decouple tab); see WS-12 | WS-12 |
| H | Diff reviewability policy split across `exec.ts` + `diff.ts` | **confirmed** (genuinely cross-file) | include as-stated | WS-7 |

Additional **TN-only** findings not in the Codex prompt are folded in as WS-3, WS-4, WS-9, WS-11, WS-13, WS-14, plus the lower-priority cleanups list.

---

## Workstreams

Each workstream lists: **Why** · **Evidence** (file:line) · **Change** · **Tests** · **Risk** · **Deps**. Workstreams are grouped by tier; the tier is the recommended execution order.

### Tier 0 — Vocabulary isolation (low risk, high signal; do first)

#### WS-1 — Delete the dashboard `/workflows` and `/kanban` route surface  *(Codex A)*

- **Implementation status (2026-05-31):** Complete. `/workflows` and `/kanban` now hit the not-found route, the unused `legacyPaths` descriptor field is gone, and docs and tests were updated to reflect no legacy aliases.
- **Why:** Product language is Run/Formula. The dashboard owns no `workflow` routes per `specs/architecture/formula-run-detail-type.md:63,472`, yet `App.tsx` still ships client-side redirects — a documentation-vs-implementation divergence keeping the dead concept alive.
- **Evidence:** `frontend/src/App.tsx:80-84` — `<Route path="/workflows" element={<Navigate to="/runs" replace />} />` and the same for `/kanban` (SPA client redirect, not an HTTP 302). `shared/src/views.ts:69-70` — a `legacyPaths` redirect field that is **defined but never used** by any module.
- **Change:**
  1. Delete the two `<Route>` redirects and the explaining comment in `App.tsx`.
  2. Delete the unused `legacyPaths` field from the view-registry type in `shared/src/views.ts` (no module declares it → dead contract).
  3. Update the contracts that still teach the deleted field/routes: `specs/requirements/modular-dashboard-prd.md` (`legacyPaths`, `/workflows` core-route examples), `specs/architecture/module-author-checklist.md` (`legacyPaths?`), and any stale `/workflows` references in non-archived docs. No redirect compatibility remains.
- **Tests:** Add a route test asserting `/workflows` and `/kanban` render the not-found surface (not a redirect to `/runs`); confirm `/runs` still works. Verify no `<Link>`/`navigate()` in `frontend/src` targets these paths (grep clean today).
- **Risk:** Intentional route break. Old bookmarks now 404 — correct per spec and no-backcompat directive.
- **Deps:** none.

#### WS-2 — Rename dashboard-owned `workflow` types/fields to run vocabulary  *(Codex B)*

- **Implementation status (2026-05-31):** Complete for the dashboard DTO surface covered here. Supervisor wire payloads still use `workflow_id`, but backend decoders normalize them to dashboard `run_id`; tests pin that edge mapping and the maintainer triage `run_id` field.
- **Why:** The `workflow → run` translation is applied at only ~half the wire edge, so the dashboard interior speaks two dialects for one concept. AGENTS.md mandates translating at the edge, and there is no need to preserve old dashboard field names for external clients.
- **Evidence (rename — dashboard-owned leaks):**
  - `shared/src/run-detail.ts:202,205` — `WorkflowFormulaSource` → **`RunFormulaSource`** (consumed by `backend/src/runs/formula-name.ts:1,17` and `frontend/src/routes/FormulaRunDetail.tsx:250`).
  - `shared/src/index.ts:649` — `GcFormulaRun.workflow_id` → **`run_id`**.
  - `shared/src/index.ts:693` — `GcFormulaRecentRun.workflow_id` → **`run_id`**.
  - `shared/src/index.ts:1038` — `TriageItem.workflow_run_id` → **`run_id`** (stamped at `backend/src/views/modules/maintainer/router.ts:546`, read at `frontend/src/views/modules/maintainer/TriageSignals.tsx:39,43`).
- **Evidence (keep — genuine wire):** `gc-client.ts:86` endpoint path `/v0/city/{city}/workflow/{workflow_id}`; `gc-supervisor-decoders.ts:50-51,299-300,347,362` raw Zod schemas mirroring OpenAPI `WorkflowSnapshotResponse`/`FormulaRunResponse`. These stay `workflow_*`.
- **Change:** Rename the four dashboard-consumed symbols with no deprecated aliases. **Critically:** until WS-10 sheds raw `Gc*` wire mirrors from `shared`, `GcFormulaRun`/`GcFormulaRecentRun` are *decoder output* shapes even though the supervisor wire sends `workflow_id`; remap at the edge (`workflow_id → run_id`) and update the propagation site `snapshot/collectors/runs.ts:808` (`run.root_bead_id ?? run.workflow_id`). WS-10/WS-9 later replaces these temporary shared feed mirrors with backend-only generated supervisor types plus dashboard DTOs, so do not introduce long-lived compatibility names. Also fix the `TriageItem` field JSDoc, which points at the **deleted** `/workflows/<id>` route (`index.ts:1026`) → `/runs/<id>`. **Field name is `run_id`** (resolved — spec Naming Boundary L62 "Dashboard DTO identity is runId"; the "best-known-at-sling-time, not live" nuance stays in the JSDoc, not the name).
- **Tests:** Update `backend/src/views/modules/maintainer/maintainer-sling.test.ts` (asserts `workflow_run_id` stamping ~799-876), `frontend/src/views/modules/maintainer/TriageSignals.test.tsx`, `backend/test/gc-client.test.ts`, `backend/test/snapshot-runs.test.ts`, and `shared/src/index.test.ts`. Add a decoder/edge test proving supervisor wire `workflow_id` maps to dashboard `run_id`.
- **Risk:** `shared` is currently the cross-workspace dashboard contract → run the full validation gate. The `TriageItem.workflow_run_id` JSDoc carries "best-known-at-sling-time" semantics — preserve that meaning in a one-line comment on the renamed `run_id`.
- **Deps:** none (but conceptually pairs with WS-5/WS-6 which finish the same translation in logic).

---

### Tier 1 — Quick-win de-duplication (low risk; reverses drift and deletes lines)  *(TN review)*

#### WS-3 — Reuse the canonical clock / format / tone / error helpers

These are pure deletion-via-reuse. Each fork has **drifted into a user-visible inconsistency**, so fixing them removes bugs, not just lines.

- **Implementation status (2026-05-31):** Complete. Route-local clocks now use `useNow()`, maintainer date/relative-time forks use canonical helpers, bead status tone is centralized at `StatusBadge`, and repeated API-error formatting is centralized in `api/client.ts`. Focused tests pin the 24h age boundary and bead status tone mapping.
- **Clock (`useNow`) — 6 routes reintroduce a banned anti-pattern.**
  - **Why/Evidence:** `frontend/src/contexts/NowContext.tsx` is mounted app-wide (`App.tsx:54`) and its own header comment names per-hook intervals as "the explicit anti-pattern flagged in the Phase 1 review." Yet `Mail.tsx:60-61`, `Agents.tsx:142,157`, `Activity.tsx:21-22`, `AgentDetail.tsx:60,115`, `Runs.tsx:63,68`, and `FormulaRunDetail.tsx:87-93` each run their own `useState(Date.now())` clock — and `FormulaRunDetail` hand-rolls a raw `setInterval` + `document.hidden` guard, re-implementing `useVisibleInterval`.
  - **Change:** Delete all six clock pairs → `const now = useNow()`. If a route needs a coarser cadence, that's a `NowContext` granularity prop, not a sixth timer.
- **Date/time formatters — forked and drifted (48h vs 24h).**
  - **Why/Evidence:** `lib/format.ts:7,14` (`formatDate`, `formatDateTime`) and `hooks/time.ts:30` (`formatRelative`) are unit-tested canonical helpers. `Maintainer.tsx:641,648,653` and `TriageSections.tsx:535` re-implement them — `formatRelative` forks roll to days at **48h** vs the shared **24h**, so the same screen renders ages by two grammars.
  - **Change:** Delete the four local helpers; import the shared ones. Thread `useNow()` in as the explicit `now` arg (also fixes the never-re-ticking-age staleness in the forks).
- **`beadStatusTone` — same bead, different color in body vs list.**
  - **Why/Evidence:** `components/BeadBody.tsx:182-194` maps `open → warn`; `routes/Beads.tsx:488-500` maps `open → neutral`.
  - **Change:** One exported `beadStatusTone(status)` next to `StatusBadge` (which owns `StatusTone`/`TONE_*`). Pick the correct mapping once; delete both.
- **`ApiClientError` formatting ladder — re-rolled 4×.**
  - **Why/Evidence:** `Beads.tsx:82`, `AgentDetail.tsx:214,411` each re-implement `err instanceof ApiClientError ? ... : err instanceof Error ? ...` while the shared `errorMessage()` is ignored.
  - **Change:** Promote one `formatApiError(err): string` (and `apiErrorParts(err)` for the structured case) into `api/client.ts` next to `ApiClientError`; all sites call it.
- **Tests:** Existing `format.test.ts` / `time.test.ts` cover the canonical helpers; add component assertions that maintainer ages and bead tones now match the rest of the app. Pick the 24h vs 48h grammar deliberately and lock it.
- **Risk:** None structural; verify the chosen `formatRelative` boundary is the intended one before deleting the 48h forks.
- **Deps:** none.

#### WS-4 — One partial-list predicate + one degraded-source notice

- **Implementation status (2026-05-31):** Complete. Backend routes now share `isPartialList`/`partialReasonsFromList`/`formatPartialErrors`; Agents and Runs use one `PartialDataNotice` component for degraded-source warnings.
- **Why:** The "is this supervisor list degraded?" check is product-critical (drives the partial badge) and is hand-duplicated; a comment at `routes/runs.ts:168` records it was **lost once in the workflow→run rename and had to be restored**.
- **Evidence (backend):** `routes/runs.ts:171`, `routes/links.ts:117,128` all repeat `list.partial === true || (list.partial_errors?.length ?? 0) > 0`. **Evidence (frontend):** `Agents.tsx:351-359` and `Runs.tsx:154-162` duplicate the `role="status"` "X partial" banner (the Runs comment at `:80` says "Mirrors the roster-partial signal in Agents.tsx").
- **Change:** Backend — `isPartialList(list)` + `partialReasonsFromList(list)` in a shared `lib/` module (pairs with `formatPartialErrors` from `links.ts:149`). Frontend — a tiny `<PartialDataNotice show title>` warn-toned `role="status"` component.
- **Tests:** Unit-test the predicate; component test the notice; keep existing route partial-path coverage green.
- **Risk:** Low. This is the canonical-helper extraction the prose comments are groping toward.
- **Deps:** none. (Conceptually overlaps WS-13's error-honesty theme.)

---

### Tier 2 — Canonical resolvers & policy (medium risk; unblocks Tier 3 splits)

#### WS-5 — Canonical run-formula identity resolver  *(Codex C — include modified)*

- **Implementation status (2026-05-31):** Complete. `resolveRunFormulaIdentity(mode, input)` centralizes formula name/source/target resolution for route/detail/state/lane consumers while preserving the intentional mode differences (`gc.formula_name` route precedence, formula-detail-before-title state precedence, and `mol-`-only lane title fallback).
- **Why:** Formula name/source/target is resolved in **6 places** with divergent precedence, kept in sync by ~40 lines of prose. The UI can disagree with itself about the same run.
- **Evidence (the 6 ladders, verbatim from validation):**
  1. `runs/formula-name.ts:59-74` `resolveRunFormulaName` — NAME: `gc.formula → title` (gated on `gc.formula_contract='graph.v2' && gc.run_target && !closed`).
  2. `runs/formula-run.ts:208-210` `runFormula` — NAME: `gc.formula → gc.formula_name → null`.
  3. `runs/formula-run.ts:216-238` `runFormulaState` — NAME: `runFormula() → formulaDetail?.name → resolveRunFormulaName()`.
  4. `runs/formula-run.ts:240-256` `runFormulaDetailState` — NAME: `runFormula(root) → formulaDetail?.name`.
  5. `routes/runs.ts:120-124` `getRunFormulaDetail` — NAME: `(source==='metadata' ? resolved.name) → gc.formula_name → resolved.name`. **Intentional** (comment `:114-119`: `gc.formula_name` must win over title-fallback).
  6. `snapshot/collectors/runs.ts:524-546` `runFormula` — NAME: `pr_review.workflow_formula → gc.formula → title` with **extra gate** `title.startsWith('mol-')`. **Intentional** (comment `:502-523`).
  - TARGET is **byte-for-byte identical** at `formula-run.ts:213` and `routes/runs.ts:126`: `gc.run_target ?? gc.routed_to ?? assignee`.
- **Change:** One `resolveRunFormulaIdentity(root, formulaDetail?, mode)` in `formula-name.ts` returning typed `{ name, source: 'metadata'|'title_fallback'|'formula_detail'|null, target }`. **Use an explicit `mode` enum (`'lane' | 'detail' | 'route' | 'state'`), NOT boolean option flags** — the validation explicitly warns that flag combinations (`includeFormulaNameKey` + `requireTitlePrefix` + …) create untested permutations. The mode encodes each call site's *intentional* divergence (the `mol-` prefix gate, the `pr_review.workflow_formula` key, the `gc.formula_name`-wins rule). Delete `runFormula`/`runFormulaTarget` copies and the inline target resolution.
- **Tests (write first):** Lock each mode's precedence and the missing-metadata behavior as separate cases, especially: (a) `gc.formula_name` beats title-fallback in `route` mode; (b) `lane` mode rejects a non-`mol-` title that `detail` mode would accept; (c) target precedence identical across modes.
- **Risk:** Behavior-change risk if the consolidated internal order shifts — the two intentional divergences (`mol-` gate, `gc.formula_name`-wins) **must** survive. Pin them with red tests before refactoring.
- **Deps:** Pairs with WS-2 (same vocabulary edge). Prerequisite for WS-8.

#### WS-6 — Canonical run-scope / store-ref module  *(Codex D)*

- **Implementation status (2026-05-31):** Complete. `backend/src/lib/run-scope.ts` now owns request-scope validation, snapshot scope parsing, bead/feed scope parsing, and store-ref parsing while preserving the three distinct missing-scope contracts (request optional, lane unavailable, enrichment throws).
- **Why:** Scope is parsed from 5 input formats across the backend, with one true duplicate and three different missing-scope contracts.
- **Evidence:** Request query `routes/runs.ts:251-281`; bead metadata `gc.scope_kind`/`gc.scope_ref` `snapshot/collectors/runs.ts:287-344`; feed snapshot `discoverFromFeed` `:788-835`; store-ref `"kind:ref"` parsing `:348-361` (`parseRunScopeKind`, `scopeKindFromStoreRef`, `scopeRefFromStoreRef`); `GcRunSnapshot` fields `runs/enrich.ts:40-50`. **True duplicate:** `enrich.ts:126` `parseScopeKind` re-implements `collectors/runs.ts:348` `parseRunScopeKind`.
- **Change:** A typed `backend/src/lib/run-scope.ts` exposing `RunScope`/`StoreRef` types and `fromRequest`, `fromSnapshot`, `fromFeed`, `fromRootMetadata`, `fromStoreRef`. Collapse the duplicate `parseScopeKind`. Apply `SCOPE_REF_RE` consistently (today it's enforced at feed + route but **not** at bead-metadata parse).
- **Critical — preserve the 3 distinct missing-scope contracts:** HTTP query → silent `undefined` (`routes/runs.ts:280`); lane builder → structured `status:'unavailable'` (`collectors/runs.ts:341-343`); enrichment → **throws `UnsupportedRunError`** (`enrich.ts:50`). The helpers must keep these per-layer behaviors, not unify them into one.
- **Tests:** Unit-test each `fromX` and each missing-scope contract boundary; keep existing route/enrich scope-validation tests green.
- **Risk:** Conflating the three contracts would silently change error behavior. Keep return types layer-appropriate.
- **Deps:** Prerequisite for WS-8.

#### WS-7 — Consolidate run-diff reviewability policy  *(Codex H)*

- **Implementation status (2026-05-31):** Complete. `backend/src/runs/run-diff-policy.ts` owns both the git pathspec exclusions and in-memory path/classification policy; `exec.ts` and `runs/diff.ts` import it so `.beads`/`.gc` reviewability cannot drift.
- **Why:** The `.beads`/`.gc` exclusion rule exists in **two backend files in two representations** that can drift.
- **Evidence:** `backend/src/exec.ts:70-77` `RUN_REVIEWABLE_PATHS` (git pathspec syntax `:(exclude,top).beads/**`) vs `backend/src/runs/diff.ts:20` `CONTROL_PLANE_PATH_PREFIXES = ['.beads','.gc']` (string-prefix), with `isReviewableRunDiffPath` applied at **8 call sites** in `diff.ts` (`:50,52,190,193,284,346,352,381`).
- **Change:** One `backend/src/runs/run-diff-policy.ts` exposing `PATHSPECS` (the git exclude args), `isReviewablePath(path)`, and `classifyFile(path)`. `exec.ts` imports `PATHSPECS`; `diff.ts` replaces its 8 prefix checks + the classify call. Within `diff.ts`, also drop the redundant re-filter in `mergeChangedFiles:284` (paths already filtered upstream) and centralize the `a/`…`b/` path-normalization so the patch/name-status/status parsers share one extract-then-test pair (TN runs/routes #5).
- **Tests:** Property-style test asserting the git-pathspec exclusion and the string-prefix `isReviewablePath` produce **identical** results across a diverse path set (including `.beads/x`, `.gcfoo`, `src/.gc/...`). Keep `diff.ts` route coverage green; preserve "untracked non-ignored agent output stays visible, `.beads/**` + `.gc/**` always excluded."
- **Risk:** Low–medium; the two formats must stay provably equivalent — the property test is the guard.
- **Deps:** none.

---

### Tier 3 — Module decomposition (behavior-preserving relocation)

#### WS-8 — Decompose `snapshot/collectors/runs.ts` (878 LOC)  *(Codex E — include modified)*

- **Implementation status (2026-05-31):** Complete. The public `snapshot/collectors/runs.ts` file is now a thin facade over focused `snapshot/collectors/runs/` modules for constants, filtering, grouping, presentation, progress, discovery, and cache wiring. The n6f1 degraded fan-out semantics and public imports are pinned by tests.
- **Why:** A god-collector fusing transport, grouping, scope, formula identity, feed discovery, lane projection, and presentation. Four section banners already exist (`:70,91,437,593`) but 180 lines of async transport (`:698-878`) are unlabeled.
- **Change:** Split into `snapshot/collectors/runs/` modules along the validated seams:
  - `filter.ts` (pure: `runBeadFilter`), `presentation.ts` (pure: `displayTitle`, `statusCounts`, `externalReference`/`externalUrl`/`externalLabel`, `recentChanges`, `metadataString`, `compareLanes`), `progress.ts` (pure: `runProgress`, `runStagePosition`, `runStepAttempt`), `grouping.ts` (`buildRunSummary`, `runLane`, `runRootId`, `runCounts`, `runKind`), `discovery.ts` (async: `loadRunBeads`, `discoverFromFeed`, `runRigNames`, `unionRigNames`, `uniqueBeads`), `cache.ts` (`createRunsSourceCache`, `buildDefaultLoad`, the unavailable/empty placeholders), and `index.ts` as the internal module facade.
  - Keep `backend/src/snapshot/collectors/runs.ts` as the public facade that re-exports from `./runs/index.js`, or update every explicit `.js` import. Current ESM imports such as `./collectors/runs.js` do **not** resolve to `runs/index.js`.
  - **Consume the canonical modules, do not re-extract:** formula identity → WS-5's resolver; scope → WS-6's `run-scope.ts`. (This is why E is sequenced after C and D.)
- **Tests:** Reorganize collector tests to mirror modules; the pure transforms become unit-testable without IO. Public API unchanged → existing consumers compile.
- **Risk:** **Preserve the n6f1 degrade-not-collapse block verbatim** (`:734-756`, per-source try/catch + `partial` flag + `logWarn`) — do not "simplify" it into `Promise.allSettled` that hides per-source semantics. Verify no circular import (`phaseMapping` is a pure leaf; confirmed). Grep for any deep import of internal functions before moving.
- **Deps:** WS-5, WS-6.

#### WS-9 — Decompose `shared/src/index.ts` (1139 LOC) + introduce `Avail<T>` / `GcList<T>` generics  *(TN shared)*

- **Implementation status (2026-05-31):** Complete for the shared barrel split and list-generic work. `shared/src/index.ts` is now a thin 30-line package-root barrel. Runtime values Claude called out live in leaves and remain value-exported from the barrel: `operator.ts` owns `OPERATOR_DISPLAY_ALIAS`, `OPERATOR_WIRE_ALIAS`, `GC_EVENT_PREFIX`, and `errorMessage`; `context-window.ts` owns `TRUE_CONTEXT_WINDOWS` and `effectiveContextPct`. Runtime values already owned by leaves (`SCOPE_REF_RE`, `CITY_NAME_RE`, `makeNodeKey`) remain in those leaves and are re-exported by the barrel. `lists.ts` owns `Avail<T>`, `GcPartialAware`, `GcList<T>`, `GcCountedList<T>`, and `GcRequiredPartialList<T>`; simple snapshot availability states and repeated list envelopes are wired through those generics, while genuinely irregular status unions remain explicit. Domain DTOs moved to focused leaves: `transcript.ts`, `gc-agents.ts`, `gc-rigs.ts`, `gc-beads.ts`, `gc-mail.ts`, `activity.ts`, `gc-health.ts`, `gc-events.ts`, `formula-runs.ts`, `api-error.ts`, and `maintainer-triage.ts`. Remaining supervisor-wire shedding belongs to WS-10 cleanup, where generated OpenAPI response validators and upstream schema-source accuracy let the temporary dashboard-side adapters disappear.
- **Why:** A god-barrel that changes independently for beads, mail, health, triage, runs, and events (SRP violated wholesale); the type-only import cycle it already worked around (`gc-client-types.ts`) is a symptom of the barrel being load-bearing.
- **Evidence:** `shared/src/index.ts` domains: sessions/context (`:64-124`), transcript (`:136-153`), agents (`:170-226`), rigs (`:239-253`), beads (`:257-368`), mail (`:377-464`), activity (`:469-501`), health (`:505-593`), events (`:597-624`), formula/order runs (`:634-802`), maintainer triage (`:815-1121`). Two boilerplate patterns hand-copied: the `{status:'available'} | {status:'unavailable',error}` union ~9× in `snapshot/types.ts:239-480`; the `{items,total?,partial?,partial_errors?}` list envelope 8× (`index.ts:217,244,319,429,612,662`; `gc-client-types.ts:63`).
- **Change:**
  1. Carve domain leaves (`gc-beads.ts`, `gc-mail.ts`, `gc-agents.ts`, `gc-rigs.ts`, `gc-health.ts`, `gc-events.ts`, `formula-runs.ts`, `maintainer-triage.ts`, `context-window.ts` for `effectiveContextPct`+registry). Keep `index.ts` a thin barrel that preserves runtime value exports as well as type exports, or add subpath exports and update all consumers in the same PR.
     - Runtime values currently **defined in `index.ts`** need a new home before the barrel can shrink: `OPERATOR_DISPLAY_ALIAS`, `OPERATOR_WIRE_ALIAS`, `GC_EVENT_PREFIX`, `errorMessage`, `TRUE_CONTEXT_WINDOWS`, and `effectiveContextPct`.
     - Runtime values already **defined in leaf modules** should survive via re-export if the barrel keeps the relevant `export *`: `SCOPE_REF_RE` (`run-detail.ts`), `CITY_NAME_RE` (`city.ts`), and `makeNodeKey` (`links.ts`). Do not move these merely because consumers import them from the package root today.
  2. Add `type Avail<T> = { status:'available' } & T | { status:'unavailable'; error:string }` → collapses ~9 unions to one (~90 lines → ~10) and surfaces the 3 genuinely-irregular unions.
  3. Add `GcList<T>` / `GcCountedList<T> extends GcPartialAware` → collapses the 8 envelopes; model the required-vs-optional `partial` outliers as an explicit one-token override (today a silent prose divergence).
- **Tests:** `shared/src/index.test.ts` + full validation gate. Re-export surface unchanged unless the PR explicitly adds subpath exports and rewrites consumers.
- **Interaction with WS-10 (important):** once WS-10 hard-cuts `GcClient` to the `@hey-api/openapi-ts` SDK, the **raw `Gc*` wire-mirror types here are shed, not relocated** — they are replaced by generated supervisor types (backend-side), and `shared` keeps only the dashboard-owned run-vocab DTOs (`RunDetail`, `FormulaRunDetail`, `TriageItem`, …) the frontend actually consumes. So WS-9 splits a smaller surface than its 1139-line starting point implies; sequence the barrel split **after** WS-10 G-1b so you carve the right boundary (dashboard DTOs vs generated wire).
- **Docs status:** `AGENTS.md` and `specs/architecture/overview.md` now describe the boundary correctly: `shared/` owns dashboard `/api/*` DTOs, while GC supervisor wire shapes are generated backend-only from OpenAPI and translated at the backend edge. `AGENTS.md` also reflects that root `npm run typecheck` now chains `typecheck:test`, and that the formula-run harness base URL defaults to `http://127.0.0.1:5174` but can be overridden with `SNAP_BASE`.
- **Risk:** This is the largest mechanical change; do it as a pure relocation in one pass and lean on the compiler. Pairs with WS-2 (rename happens in the same files).
- **Deps:** After WS-2 (rename) and WS-10 G-1b (so the generated/dashboard boundary is set before carving leaves).

#### WS-10 — Replace the hand-written supervisor edge with a generated client (`@hey-api/openapi-ts`)  *(Codex F + TN supervisor — redesigned per resolved decision)*

- **Implementation status (2026-05-31):** In progress. G-0 is complete: repo engines and CI now require Node `>=22.13.0`. G-1a is complete: `backend/openapi-ts.config.ts` generates a committed hey-api SDK/type/client/Zod folder under `backend/src/generated/gc-supervisor-client`, and `openapi:gc-supervisor:check` regenerates into a temp dir and byte-compares that generated tree. G-1b transport cutover is complete: `GcClient` now calls the generated SDK and `@hey-api/client-fetch` runtime, and the old `openapi-typescript` artifacts, `openapi-fetch` dependency, custom schema-map extractor, AJV overlay, and generated schema validator have been deleted. G-1c is complete: generated files no longer carry `// @ts-nocheck`, are no longer excluded from backend TypeScript, are no longer ignored by ESLint, and `npm run typecheck` / `npm run lint` fail on generated-client issues (`lint` already uses `--max-warnings=0`). The generator wrapper does not post-process generated output; `@hey-api/client-fetch` is configured with `bundle: false` so the generated tree imports the runtime package instead of copying patchable runtime files into `src/generated`. Because the published `@hey-api/client-fetch` package types lag the current `@hey-api/openapi-ts` generator, `backend/src/types/hey-api-client-fetch-compat.d.ts` is an ambient type-only compatibility shim pinned by tests; it is not wired through `tsconfig.paths`, so runtime imports still resolve to the real npm package. The runtime HTTP path is tested to execute generated response validators, and generated SSE helpers remain unused because this dashboard proxies SSE through backend routes. G-3 response validation is now enabled with the hey-api SDK `validator: { response: 'zod' }` option and the generated `zod.gen.ts` file; malformed supervisor payloads are rejected before DTO mapping. Concrete write-edge casts are being removed as found; `sendMail` now decodes its created-message response instead of casting. Remaining WS-10 gaps are explicit: `gc-supervisor-decoders.ts` remains a temporary hand-Zod DTO adapter/normalizer on top of generated response validation, some raw supervisor mirror shapes still live in `shared/` until the adapter cleanup moves them backend-only, and upstream GC supervisor API schema gaps such as nullable `Bead.priority` are tracked in `specs/architecture/formula-run-detail-type.md`.

**Decision (grill + gascity reference + no-backcompat directive):** Don't tidy the hand-rolled edge — **replace it.** Generate the supervisor client + types (+ SSE-capable SDK surface) from `backend/openapi/gc-supervisor.openapi.json` with `@hey-api/openapi-ts`, exactly as the upstream `gascity` dashboard does (`~/code/gastownhall/gascity/cmd/gc/dashboard/web/openapi-ts.config.ts`: plugins `@hey-api/client-fetch`, `@hey-api/typescript`, `@hey-api/sdk`, generating the whole `client.gen.ts`/`sdk.gen.ts`/`types.gen.ts`/SSE surface with **zero** hand-written client). Unlike gascity (which validates **nothing** at runtime), also enable the **Zod plugin** so the same spec generates runtime response validators — honoring this repo's spec invariant *"runtime deserialization at GcClient rejects malformed payloads"* (Ideal #2, L691). The target is a **100% generated supervisor API client**, with only non-API dashboard policy and DTO mapping hand-written.

- **Why:** `gc-client.ts` (866) and `gc-supervisor-decoders.ts` (879) are ~1.7k hand-written lines reimplementing what the generator produces — path/param construction, request/response types, and per-resource validation — plus three overlapping representations (generated OpenAPI/AJV + hand-Zod + the `SchemaOutputFor` type-machine) and a write edge that casts unknown via `writeJson<T>` (`:261-282`).
- **Prerequisite:** Current `@hey-api/openapi-ts` releases require Node `>=22.13.0`. G-1 uses Node `>=22.13.0`; do not retain a Node-20 fallback path.
- **Generated code is backend-only.** The security model (backend binds 127.0.0.1, redacts, proxies; the browser only talks to `/api/*`) keeps supervisor types out of the frontend bundle. The generator inputs are the supervisor OpenAPI document plus `backend/openapi-ts.config.ts`; `scripts/generate-gc-supervisor-client.mjs` stays a regenerate/check wrapper, not a second schema generator. No generated-output post-processing is allowed: if generated code fails strict type/lint gates, fix the OpenAPI schema, generator configuration, or upstream tool dependency rather than patching generated files. Output lives under `backend/src/generated/gc-supervisor-client/`; generated code imports `@hey-api/client-fetch` via `bundle: false`. The temporary ambient type shim for that runtime package is not an API-shape authority, must not be used as a runtime path alias, and should be deleted when the published runtime types catch up to the current generator.
- **`GcClient` becomes a thin policy facade** over the generated SDK, owning only what the generator can't: **single-flight URL-keyed coalescing**, **topology-safe error redaction**, **timeouts/output-cap**, the **`workflow_id → run_id` vocabulary normalization** at the edge, and **sane dashboard method names** (generated `getV0CityByCityNameWorkflowByWorkflowId` → `getRun`). It should not own API path construction, operation lookup, wire response typing, or generated-schema extraction. The 866-line client collapses to this facade; the ~16× `getOperation` template (TN supervisor #5) disappears into the generated SDK.
- **Delete by phase, not by wishful thinking:** G-1b deletes `backend/src/generated/gc-supervisor.ts` (old `openapi-typescript` output), `backend/src/generated/gc-supervisor-schemas.ts` (custom extracted schema map), `gc-supervisor-schema-validator.ts` (AJV overlay), `openapi-fetch`, and the custom schema-extraction half of `scripts/generate-gc-supervisor-client.mjs`. `GcClient` must not keep a parallel hand-written supervisor client. The only acceptable temporary adapter is `gc-supervisor-decoders.ts` as a narrow dashboard DTO mapper with generated hey-api input types and a named cleanup condition. Generated Zod response validation is now safe and enabled; the remaining deletion work is to replace hand-Zod schemas/`SchemaOutputFor` with typed DTO mapping over generated outputs and to move residual raw supervisor mirrors backend-only.
- **Accuracy fixes are upstream GC supervisor API gaps.** The 15 opt-outs exist because the supervisor OpenAPI rejects valid degraded payloads (nullable `Bead.priority`; legacy bead fields `owner`/`updated_at`/`closed_at`; the phantom event `next` key; `description`-required formula detail). Fix these **in gastownhall/gascity's Huma/OpenAPI source** so the committed spec matches observed output; this repo re-pulls via `npm run openapi:gc-supervisor:update`. **This is a cross-repo dependency — the single riskiest part of this plan, and it is tracked in specs rather than patched as part of this dashboard work.**
- **Phased rollout (forced by the accuracy dependency):**
  - **G-0 (toolchain):** Move CI/local runtime to Node `>=22.13.0`. This is not optional for current `@hey-api/openapi-ts`.
  - **G-1a (generation):** Add `@hey-api/openapi-ts`; generate client+types+SDK from `backend/openapi/gc-supervisor.openapi.json`; make `openapi:gc-supervisor:check` compare the generated tree.
  - **G-1b (hard cutover, no compatibility aliases):** Re-point `GcClient` internals at the generated SDK (transport + types). Delete the hand request/path/operation plumbing, `openapi-fetch` client code, old generated `openapi-typescript` artifacts, and custom schema extractor. Translate `workflow_id → run_id` in a thin dashboard DTO adapter; do not expose old dashboard aliases.
  - **G-1c (generated strictness):** Complete. Remove the `// @ts-nocheck` post-generation rewrite and make generated artifacts part of the normal `tsc` + ESLint gates. The generated tree imports `@hey-api/client-fetch` with `bundle: false`, so the dashboard does not copy or patch hey-api runtime internals. A single ambient type-only runtime compatibility shim covers the current npm package/generator version skew and is pinned by tests; any future generated strictness failure is treated as an OpenAPI/config/tooling bug to fix at the source.
  - **G-2 (upstream):** Land the OpenAPI accuracy fixes in gascity; refresh the committed spec here; add fixtures for the previously-degraded shapes. The dashboard's committed OpenAPI already carries the nullable `Bead.priority` correction needed by the current generated validators, but the upstream GC supervisor Huma/OpenAPI source must be fixed before this dashboard relies on future `openapi:gc-supervisor:update` refreshes.
  - **G-3 (strict generated validation):** Complete for runtime response validation. Generated-**Zod response validation** is enabled at the `GcClient` edge; malformed payloads now fail before DTO mapping per the spec invariant. The remaining G-3 cleanup is to delete any temporary hand-Zod schemas/normalizers that only existed to bridge schema drift. This subsumes the WS-13 `getStatus`/`decodeSling` all-optional fixes (the generated validators + accurate required fields replace those hand schemas). The only surviving hand code at this boundary should be dashboard policy and explicit DTO mapping the generator cannot express.
- **hey-api features to leverage (verified against current docs, May 2026 — maximize generated code per the directive):**
  - **SDK `validator` option** — `validator: { response: 'zod' }` wires the generated Zod schemas into every SDK call (async `parseAsync`), so **OpenAPI-shape runtime response validation is generated, not hand-written**. This is now enabled. Current hey-api fetch-client output validates but discards the parsed/coerced return value, so dashboard DTO normalization still belongs in explicit mapping code for now. The follow-up cleanup should shrink `gc-supervisor-decoders.ts` from a hand-Zod validator module into explicit DTO mapping only, then delete it if the mapping becomes small enough to live with the facade methods. Use response-only validation (we build request shapes; the supervisor's responses are what need guarding).
  - **Zod v4 plugin** — generates Zod 4 schemas by default; backend is already on `zod ^4.4.3`, so no version bump.
  - **Transformers plugin (built into `@hey-api/openapi-ts`, not a separate npm package)** — generates response transformers (e.g. ISO date-time → `Date`, big-int handling) so any hand date/number coercion at the edge disappears. Implementation note: there is no published `@hey-api/transformers` package in npm as of this pass; configure it as a plugin name through the generator if/when we adopt it, not as an install dependency.
  - **client-fetch interceptors + `createClientConfig()`** — `client.interceptors.{request,response,error}.use(...)` is where facade policy lives: **topology-safe error redaction** (response/error interceptor), `Origin`/auth headers, and logging — instead of hand-wrapping each call. `runtimeConfigPath`'s `createClientConfig()` centralizes `baseUrl` (the city URL), a custom `fetch` (timeout + output-cap + 127.0.0.1), and `throwOnError`.
  - **What must stay hand-written (interceptors can't express it):** single-flight URL-keyed **coalescing** (a dedupe layer above the SDK) and the **`workflow_id → run_id` rename** (a field remap, not a type transform). These two are the irreducible core of the `GcClient` facade.
  - **Prerequisite (verified):** hey-api is **ESM-only as of 2026** and requires Node `>=22.13.0`; backend is already `"type": "module"` + `moduleResolution: bundler`. The migration has removed `ajv`, superseded `openapi-typescript`, and removed `openapi-fetch`.
  - **Out of scope (noted, not silently dropped):** hey-api's TanStack Query plugin would cut the *frontend's* per-route fetch/poll boilerplate — but only if the dashboard's own `/api/*` had an OpenAPI to generate from, which it doesn't today. Authoring a dashboard-side OpenAPI to unlock that is a separate, larger initiative, not part of WS-10.
- **Tests:** Retire `gc-supervisor-decoders-types.test.ts` when `SchemaOutputFor` dies; generated-Zod validation is now covered by `backend/test/gc-supervisor-generation-config.test.ts` and malformed-payload `GcClient` tests. **Keep `GcClient`'s coalescing / redaction / `workflow_id→run_id` tests green — those behaviors must survive the rewrite.** Generator coverage now verifies the old `openapi-typescript` pipeline is gone, `openapi:gc-supervisor:check` verifies the `@hey-api` generated tree, generated code has no `@ts-nocheck`, generated Zod response validators are wired into the SDK, and generated code is covered by backend typecheck + ESLint.
- **Risk (do-not-break invariants):** single-flight coalescing, topology-safe **redaction**, timeouts/output-cap, and the `workflow_id → run_id` edge normalization must all survive in the thin facade. **SSE:** this repo proxies supervisor SSE same-origin (`routes/sse-proxy.ts`) for CSP — that's a security boundary, not just transport; **default: keep the proxy**, don't replace it with the generated browser SSE handlers. The main remaining risk is ownership drift: do not let `gc-supervisor-decoders.ts` become a second schema authority now that generated response validation is active. **Spec status:** `specs/architecture/formula-run-detail-type.md`, `AGENTS.md`, and `specs/architecture/overview.md` now describe the generated client + runtime-validation boundary and the remaining DTO-adapter cleanup.
- **Deps:** G-2 upstream source sync still depends on gascity work. Coordinate the `workflow_id → run_id` normalization with WS-2. Unblocks WS-9's shedding of the raw `Gc*` wire mirrors.

#### WS-11 — Decompose the maintainer modules + reuse canonical helpers  *(TN maintainer)*

- **Implementation status (2026-05-31):** Complete. The `/sling` request-body validation gauntlet is now a pure `sling-request.ts` decoder with focused unit coverage, serve-time slung overlay lives in `serve-overlay.ts`, and sling dispatch/audit/slung-state persistence/target-resolution/refresh-notification lives in `sling-dispatch.ts`, leaving the Express route to own HTTP decode/response/error mapping. The `/refresh` ExecError path now uses centralized `writeExecError(..., { fallbackStatus: 502 })`; `findContributor` and `countItems` reuse `collectItems`; `triage.ts` imports the shared `parseJsonArray` helper instead of carrying a duplicate parser; and `issueNumbersWithInFlightPr` is now the shared in-flight PR predicate consumed by both `computeHasInFlightPr` and `selectOneMark`. On the frontend, the pure tier transforms now live in `triageFilters.ts`, their tests import that module directly instead of reaching through `Maintainer.tsx`, maintainer collapse state now uses the shared `usePersistedCollapseSet` hook with focused persistence/parse-failure tests, `SelectionActionBar`/`MaintainerFooter` now live in `MaintainerChrome.tsx`, and `CollapsibleHeader`/`CollapseGlyph` are shared by maintainer sections and generic project-group headers.
- **Why:** `backend/.../maintainer/router.ts` (589) fuses the HTTP edge with the serve-time overlay engine and re-implements three helpers that already exist canonically; `frontend/.../Maintainer.tsx` (682) hoards pure transforms, a storage hook, and sub-views.
- **Evidence (backend):** `router.ts:182-196` re-inlines the ExecError→HTTP map that `lib/sanitise-error.ts:50-69 writeExecError` owns (used canonically in `routes/beads.ts:263`, `agents.ts:187`, `git.ts:52`); `triage.ts:154-168 parseJsonArray` duplicates `lib/parse-json.ts:4-18` (its sibling `contributor.ts:11` already imports the lib version); `router.ts:428-435,463-474` (`findContributor`, `countItems`) re-walk the envelope by hand instead of the exported `triage.ts:289-298 collectItems`; the in-flight-PR set is rebuilt at `triage.ts:327` and `:384`; the `/sling` handler is a 60-line inline validation gauntlet (`router.ts:215-276`).
- **Evidence (frontend, baseline review):** `Maintainer.tsx` held pure tier transforms (`:68,92,121`), local `useCollapseState` storage logic (`:140-180`), `SelectionActionBar` (`:508-609`), `Footer`/`buildSynopsis`; `TriageSections.tsx` + `ProjectGroupHeader.tsx` ship 3+ incompatible collapsible-header implementations with two glyph conventions.
- **Change (backend):** Complete. The inline ExecError map uses `writeExecError(..., { fallbackStatus: 502 })`; duplicate `parseJsonArray` is gone; `findContributor`/`countItems` route through `collectItems`; `issueNumbersWithInFlightPr(items)` is shared by both call sites; `decodeSlingRequest(body)` lives in pure `sling-request.ts`; `applySlungOverlay(envelope, path)` lives in `serve-overlay.ts`; and `dispatchMaintainerSling(body, deps)` owns supervisor write dispatch, audit rows, active slung-state writes, target-session resolution, and maintainer SSE refresh notification.
- **Change (frontend):** Complete. Pure tier transforms moved to `triageFilters.ts`; collapse persistence moved to `hooks/usePersistedCollapseSet`; `SelectionActionBar`/`MaintainerFooter` moved to `MaintainerChrome.tsx`; and `CollapsibleHeader`/`CollapseGlyph` now unify maintainer section and project-group collapse controls. Folds in WS-3's format reuse.
- **Tests:** `maintainer-has-in-flight-pr.test.ts` pins the shared in-flight PR predicate; `maintainer-select-one-mark.test.ts` proves the One Mark behavior still consumes it correctly; `serve-overlay.test.ts` pins the active-slung lift, stale-vetted override, run-link stamping, and empty-cluster drop; `sling-dispatch.test.ts` pins success/failure audit, slung-state persistence, target resolution, and refresh notification. `Maintainer.needs-pr.test.tsx` / `Maintainer.needs-triage.test.tsx` import real filter modules, `usePersistedCollapseSet.test.tsx` pins persistence plus parse-failure reporting, `Maintainer.test.tsx` imports the chrome components directly, and `CollapsibleHeader.test.tsx` pins the shared collapse header contract.
- **Risk:** The One-Mark invariant is split across compose-time (`triage.ts`) and serve-time (`serve-overlay.ts`), with direct tests on both halves. Behavior-preserving.
- **Deps:** WS-3 (format helpers). Independent of backend Tier 2.

#### WS-14 — `groups.ts` single-pass identity model; remove in-place `delete` mutation  *(TN runs/routes)*

- **Implementation status (2026-05-31):** Complete. `groupRunBeads` now resolves a single `BeadIdentity` per bead, buckets visible beads by semantic node id, then builds each `RunNodeGroup` from the complete bucket. Group shape selection is deterministic by construct priority and stable bead keys, optional fields are emitted with conditional object spreads rather than delete-based mutation, and badge aliases reuse the computed identity map instead of recomputing grouping identity. Tests pin order-independent group shape and guard against reintroducing `delete group[...]`.
- **Why:** `backend/src/runs/groups.ts` has five overlapping notions of bead identity computed redundantly, plus order-dependent in-place mutation — the area `relation-index.ts:7-14` flags as "the single biggest premortem failure mode."
- **Evidence:** `groups.ts:126-157` `resolveSemanticIds` computes `duplicateResolutionIdentity` twice per bead; `visibleNodeAliases:235` recomputes `groupingBaseSemanticId`; `assignOptional:106-116` does `delete group[key]` to "unset" optional fields mid-iteration (`:71-79`).
- **Change:** Compute one `BeadIdentity { base, disambiguator, aliases }` per bead, memoized in a `Map`. Group by `base`; disambiguate only when a base has >1 distinct disambiguator. Build each `RunNodeGroup` once by reducing its full bead list (two-pass: bucket → reduce) — no in-place promotion, no `delete`, no iteration-order dependence.
- **Tests:** Existing `run-groups.test.ts` golden fixtures must stay green; add a test asserting group shape is independent of bead order.
- **Risk:** Medium — this is dense, well-tested logic. Lean on the golden fixtures.
- **Deps:** none.

---

### Tier 4 — Boundary correctness (surfaces previously-hidden failures)

#### WS-12 — Split run detail/diff into independent resources; honest diff errors; decouple tab from node-selection  *(Codex G + TN hooks — resolved: both moves accepted)*

**Decision (grill):** Both Codex moves confirmed — **split the hooks** and **decouple the tab**, overriding the spec's single-hook/auto-switch model. The spec must be amended to match (see Risk).

- **Implementation status (2026-05-31):** Complete. `useFormulaRunDetail` now loads only the run projection, `useRunDiff` is an independent cached resource with its own `idle|loading|ready|failed` state, and the page refresh/event path refreshes both resources without collapsing diff failures into detail failures. `FormulaRunTabs` no longer watches selected-node changes; Session content appears only when the user selects the Session tab, so selecting graph nodes cannot override an explicit Diff choice. Focused hook/component/page tests pin the split resource behavior, real diff failure state, and tab persistence across node selection.
- **Why:** Detail and diff are independently refreshable/failable, but the hook fetches them as one `Promise.all` and **fabricates a fake success** when the diff fails; and node-selection forcibly overrides the user's tab choice.
- **Evidence:** `useFormulaRunDetail.ts:79-96` — `Promise.all([detail, diff])`; the `api.runDiff` catch (`:81-93`) returns a hand-built `{kind:'error', ...} satisfies RunDiffResponse` and the outer state still resolves `ready` (`:95`). `FormulaRunTabs.tsx:16-18` — a `useEffect` forces `tab='session'` whenever `selectedNodeId` changes; `FormulaRunDetail.test.tsx:164-169` locks this in. `RunNodeEvidencePanel.tsx:22` renders the Diff tab from `diff` alone (node-independent), so the diff is run-level/execution-folder evidence (spec invariant L721).
- **Change:**
  1. **Split** into `useFormulaRunDetail` (detail resource) and `useRunDiff` (diff resource), each its own `useCachedData` key and explicit `idle|loading|ready|failed` union; `FormulaRunDetailPage` composes both → a failed `api.runDiff` surfaces a real `failed` state instead of a fabricated `RunDiffResponse`.
  2. **Decouple** the tab: remove the `FormulaRunTabs.tsx:16-18` effect so tab state responds only to user clicks / initialization. Selecting a node no longer auto-switches to Session.
- **Tests:** **Rewrite** `FormulaRunDetail.test.tsx:164-169` to assert the tab **persists** across node-selection (was: asserts auto-switch to Session). The focused browser harness **`scripts/snap-formula-run-detail.mjs`** clicks Session *before* selecting a node, so it survives — but verify. Add a test asserting a failed `api.runDiff` yields `useRunDiff → failed`, not a silent empty diff.
- **Risk:** This is the **one run-detail interaction behavior change** in the plan: clicking a node no longer jumps to Session, and because the diff is node-independent, a node-click while on Diff now changes only the node's pressed state, not the right panel. Consumers that checked `diff.kind !== 'error'` now get an explicit `failed` state — audit them. **Spec status:** `specs/architecture/formula-run-detail-type.md` (UI Consumption + Invariants) has been amended to the two-resource + tab-as-user-state model; implement to match. The focused harness defaults to `http://127.0.0.1:5174` and can target another dev stack with `SNAP_BASE`.
- **Deps:** none.

#### WS-13 — Close the remaining swallowed-error gaps  *(TN maintainer / supervisor / hooks)*

- **Implementation status (2026-05-31):** Complete for the independent WS-13 items. `buildSlingRequests` now returns `{ requests, skippedKeys }` instead of silently dropping selected-but-vanished items, `MaintainerPage` preserves the skipped count after dispatch, and `SelectionActionBar` surfaces "`M` skipped; no longer in list" while disabling send when nothing sendable remains. The frontend `/api/*` client now threads every `api.*` method through an explicit response decoder at the single `request()` chokepoint; malformed 200 JSON is rejected with `ApiResponseDecodeError` instead of cast to the expected DTO. The supervisor `getStatus`/`decodeSling` all-optional issue is intentionally folded into WS-10 G-2/G-3 generated-Zod validation.
- **Why:** "Don't swallow errors" is an explicit project rule, violated where it's least visible.
- **Evidence + Change:**
  - `maintainerSelection.ts:64` `buildSlingRequests` silently `continue`s past selected-but-vanished items → the success line "Slung N" can be fewer than selected. **Complete:** return dropped keys; surface "M skipped" in the action bar (`Maintainer.tsx:549`).
  - `gc-supervisor-decoders.ts:419` `getStatus` and `:739` `decodeSling` are all-optional schemas → a broken-shape response decodes to `{}` indistinguishable from benign degradation. **Now subsumed by WS-10:** the generated-Zod validators (G-3) plus the upstream accuracy fixes (G-2, making the identity fields `required`) replace these hand schemas, so a wrong shape fails at the edge. No separate `.refine()` work — fix it where the schema is generated.
  - `api/client.ts:65` `request<T>` does `(await res.json()) as T` for ~25 methods while the SSE hooks validate every field. This is the **frontend `/api/*` edge** (dashboard DTOs), separate from the supervisor edge WS-10 covers. **Complete:** every `api.*` method passes a per-endpoint decoder to `request()`, and `performRequest()` rejects malformed JSON or missing top-level DTO fields instead of trusting an unchecked cast.
- **Tests:** `maintainerSelection.test.ts` and `Maintainer.test.tsx` cover the "M skipped" path. `api/client.test.ts` covers malformed successful JSON at the frontend `/api/*` edge. Generated-Zod supervisor validation tests belong under WS-10 G-3.
- **Risk:** These intentionally turn silent degradations into visible errors — confirm each surfaced error has a sensible UI path.
- **Deps:** `getStatus`/`decodeSling` now fold into WS-10 G-2/G-3. The `buildSlingRequests` and `api/client.ts` items are independent.

---

## Lower-priority cleanups (fold in opportunistically; not standalone PRs)

- **`useVisibleRefresh` vs `useAbortableVisibleRefresh`** duplicate the backoff state machine (`useVisibleRefresh.ts:37-61` vs `useAbortableVisibleRefresh.ts:44-90`). Extract `useVisibleBackoffTick({enabled,intervalMs,run,...})`; build both on top. *(TN hooks #3)*
- **`useLiveCachedData` composite** — `useCachedData(...).refresh` + `useGcEventRefresh(prefix, refresh)` is copy-pasted per route (`Beads.tsx:36,65`; `Agents.tsx:124,159`; `Runs.tsx:52,117`). Promote one hook. *(TN routes #2 / hooks #2)*
- **`ViewingAsContext` over-defensiveness** — `getSessionsRetryDelay` is ~45 lines of comment guarding a 3-element lookup (`:69-100`); the provider fuses alias-selection, sessions-retry, mail+sessions prefetch, and StrictMode bookkeeping (`:146-376`). Extract `useAliasRoster()` so the security-relevant impersonation logic isn't buried in retry/join plumbing. *(TN hooks #6/#7)*
- **Comment-archaeology / dead scaffolds** — `triage.ts:412-451 selectOneMark` carries ~25 lines refuting deleted code (violates "no comments for removed functionality"); `slung-state.ts:27-45,135-212` is ~90 lines of legacy-normalization scaffold to default one optional field. Delete the archaeology; collapse the scaffold to a single `?? null` at the read edge. *(TN maintainer #7/#8)*
- **`AgentDetail.tsx`** hand-rolls 4 parallel fetch/loading/error state machines instead of `useCachedData` (`:54-58,83-120,205-243`). Migrate to the canonical hook. *(TN routes #1/#5)*
- **`run-snapshot.ts:48,50`** `Record<string,never>[]` is `any` in disguise for `logical_nodes`/`scope_groups` — type honestly as `readonly unknown[] | null` or model the real shape. *(TN shared #7)*

## Explicitly NOT in scope (rejected to keep the plan high-conviction)

- A "unified entity chip" across `RelatedEntities` / `TriageSections` / run panels — they render genuinely different wire shapes; a shared model would be speculative (YAGNI).
- `RunNodeSessionPanel.tsx` (335) — dense but legitimately so; cleanest of the large files.
- Generated supervisor artifacts — change generator inputs, never hand-edit.
- The read-edge architecture (single decode chokepoint, single-flight coalescing, n6f1 degrade-not-collapse) — genuinely good; preserve it.

---

## Sequencing & dependency graph

```
Tier 0 (vocabulary)      WS-1 ─┐
                         WS-2 ─┼─► (unblocks run vocab; WS-2 coordinates w/ WS-10 normalization)
Tier 1 (quick wins)      WS-3, WS-4   (independent, parallelizable, ship first for momentum)
Tier 2 (resolvers)       WS-5 ─┐
                         WS-6 ─┼─► WS-8 (collector split consumes WS-5 + WS-6)
                         WS-7   (independent)
Tier 3 (decomposition)   WS-10 G-0 (Node 22/tooling) ─► WS-10 G-1a (generate @hey-api)
                         ─► WS-10 G-1b/G-3 (hard cutover + generated Zod validation) ─► WS-10 cleanup (upstream schema sync + delete temporary adapter)
                         WS-9 (after WS-2 + WS-10 G-1b), WS-11 (after WS-3), WS-14 (complete)
Tier 4 (correctness)     WS-12 (complete), WS-13 (getStatus/decodeSling folded into WS-10 G-3)
```

**Recommended order:** WS-1, WS-2 → WS-3, WS-4 (quick wins, reverse drift) → WS-5, WS-6, WS-7 (canonical resolvers/policy) → **WS-10 G-0/G-1a/G-1b/G-3** (Node 22/tooling, generate with @hey-api, hard-cut to the generated SDK, delete the old client stack, enable strict generated-Zod response validation) + WS-13 cheap-correctness items → WS-8, WS-9, WS-12 and WS-14 (complete), WS-11 (decomposition) → **WS-10 cleanup** (sync the OpenAPI accuracy fix upstream, then delete the temporary DTO adapter/`SchemaOutputFor` machinery and move raw supervisor mirrors backend-only).

Land each workstream as its own PR against `main` with passing CI. Several are parallelizable across branches (WS-3, WS-4, WS-7 touch disjoint files; WS-14 has already landed in this branch).

## Validation gate (run before every push)

```
npm run build:shared
npm --workspace shared test
npm run openapi:gc-supervisor:check
npm run typecheck
npm run lint
npm --workspace frontend run build
npm --workspace backend test
npm --workspace frontend test
```

Root `npm run typecheck` already includes backend and frontend test typechecks, and generated supervisor client code is intentionally inside the backend TypeScript project. `npm run lint` uses `--max-warnings=0` and no longer ignores `backend/src/generated`, so generated-client lint warnings fail the same gate as source warnings. `npm run build:shared` is listed separately to mirror CI setup order even though `typecheck:src` also builds shared. For WS-10 generator work, also run `npm run openapi:gc-supervisor:generate` before the check and commit generated artifacts.

For run-detail-affecting workstreams (WS-5, WS-6, WS-7, WS-8, WS-12), also run the focused harness against a live dev server:

```
npm run dev:frontend   # default target: 127.0.0.1:5174; override harness with SNAP_BASE
node scripts/snap-formula-run-detail.mjs --test
```

## Resolved decisions (locked via `/grill-me` against the specs + the upstream `gascity` dashboard)

1. **WS-12 tab behavior — DECOUPLE.** Tab is explicit user state; selecting a node no longer auto-switches to Session. Rewrite the locked test. *(Overrode the "keep auto-switch" recommendation; the diff being node-independent made the call genuinely debatable, but the user chose Codex's model.)*
2. **WS-12 resource shape — SPLIT into two hooks** (`useFormulaRunDetail` + `useRunDiff`). *(Overrode the spec's single-hook `ready={detail,diff}` model — spec amendment required.)*
3. **WS-2 `TriageItem` field — `run_id`.** Spec Naming Boundary L62 mandates uniform `runId`/`run_id` dashboard vocabulary; the "best-known-at-sling-time, not live" nuance stays in the JSDoc; fix the stale `/workflows/<id>` → `/runs/<id>` reference.
4. **No backwards compatibility for dashboard routes or DTOs.** The browser client in this repo is the only consumer of the backend service. Delete old routes/fields instead of redirecting or aliasing them.
5. **WS-10 supervisor edge — GENERATE from OpenAPI.** Adopt `@hey-api/openapi-ts` (full SDK + thin `GcClient` policy facade), modeled on gascity's dashboard. **Enable the Zod plugin** for runtime validation (diverges from gascity, which validates nothing; honors this repo's reject-malformed invariant). Fix accuracy **upstream** in gascity's OpenAPI. Phased G-0/G-1a/G-1b/G-2/G-3; no permanent parallel hand-written supervisor client, and G-1b must delete the old `openapi-typescript`/`openapi-fetch`/hand-decoder stack rather than preserving it.

### Follow-on consequences (architecture-determined; no further decision needed)

- **The generated supervisor SDK + Zod are backend-only.** The security model (backend-only supervisor access, 127.0.0.1, redaction, proxy) keeps supervisor types out of the frontend bundle. The frontend keeps `api/client.ts` as its own dashboard-DTO edge (WS-13 covers it).
- **WS-9 split the shared barrel without adding subpath API churn.** Remaining raw supervisor-wire mirror removal is now a WS-10 cleanup concern: generated response validation is active, and upstream OpenAPI source accuracy should let `shared` keep only dashboard-owned run-vocab DTOs after the temporary adapter is removed.
- **The architecture spec has been amended** (`specs/architecture/formula-run-detail-type.md`): *Naming Boundary*, *UI Consumption*, *Ideal Target State*, *Invariants*, *Risk #5*, and *Current Implementation Against The Ideal* now describe the generated `@hey-api` client + runtime validation, the two-resource hook model, and tab-as-user-state. `AGENTS.md` and `specs/architecture/overview.md` now match the generated-supervisor/dashboard-DTO boundary; keep `specs/requirements/modular-dashboard-prd.md`, `specs/architecture/module-author-checklist.md`, and `specs/requirements/product.md` under review as the remaining durable product docs are revised around `/runs` vocabulary and module boundaries.

### Remaining risk to watch

- **The Node 22/tooling move (WS-10 G-0)** is a hard prerequisite for current `@hey-api/openapi-ts`.
- **The remaining cross-repo accuracy dependency (WS-10 G-2)** is source-of-truth landing: the dashboard's committed OpenAPI has been adjusted enough for generated-Zod validation to run, but the GC supervisor Huma/OpenAPI source still needs the documented schema fixes. Land those upstream before deleting the temporary DTO adapter, so future `openapi:gc-supervisor:update` runs do not reintroduce drift.
