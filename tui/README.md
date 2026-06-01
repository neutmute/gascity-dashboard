# gas-city-dashboard-tui (prototype)

A terminal glance surface for the Gas City dashboard — the smallest viable
prototype to prove or kill the idea of a TUI an operator leaves open in a tmux
split instead of alt-tabbing to the SSH-forwarded browser tab.

## What it is (and is not)

- **Thin client of the backend `/api/*`.** It reuses the `shared` DTOs directly
  (`gas-city-dashboard-shared`), so a contract drift is a compile error here,
  not a runtime `undefined`. It talks only to the backend — never to the gc
  supervisor — so it inherits edge translation, sanitisation, timeouts, CSRF and
  audit for free (`backend/src/gc-client.ts` is the only supervisor seam).
- **Read-only.** No writes (claim/close/sling/respond) — those need the CSRF
  double-submit the web client does; out of scope for the prototype.
- **No tmux pane-attach.** Deliberately rejected: raw `capture-pane` bytes would
  bypass the server-side ANSI/OSC sanitisation that is the load-bearing XSS
  defence, and break the 127.0.0.1-only posture. Session content reaches the
  operator through the backend, not by attaching to panes.

## Views

- **List** (default): agents grouped `failed → active → idle`, one line each as
  `rig · agent · ctx% · activity · model · last-active`. Greyscale-first, with a
  single red mark for the things worth a glance (failed agents, runs needing an
  operator), honouring DESIGN.md's behavioural rules (words before colour, one
  mark of alarm) — its typographic rules are web-only.
- **Peek** (`enter` or `p`): detail for the selected agent — ids, model/context,
  the **peek commands** to run in another pane (`gc session peek <id>`,
  `tmux attach -t <session_name>`, `tmux capture-pane …`), the active run lanes
  (formulas) on its rig, and that rig's beads (best-effort, beads carry no
  session field so the match is by id prefix).
- **Health** (`h`): system resources (load / vcpu / memory), headline counts,
  runs needing an operator, context-pressure agents (≥75%), and a
  never-active-by-rig rollup — the "why are these idle agents here, could the
  mayor reallocate them?" view. Costs are shown as *not measured* (the
  supervisor exposes no per-run cost yet — see
  `specs/architecture/cost-token-feasibility.md`); they are not faked.

## Controls

`↑`/`↓` or `j`/`k` move the selection · **mouse wheel** scrolls · `PageUp`/`PageDown`
· `g`/`G` top/bottom · `enter`/`p` toggle peek · `h` toggle health · `q` (or
`esc`) quit. The selection persists across the live refresh so peeking stays put.

## Run

The backend must be running (`npm run dev:backend`) against a live supervisor.

```bash
# from repo root, after `npm install`
set -a; . ./.env.local; set +a   # defines GC_CITY_NAME
npm --workspace tui run start     # or: npm --workspace tui run start -- --city=<name>
```

### Launch inside tmux (so `enter`-peek works)

The live-peek split (`enter`) needs the TUI to be running inside tmux. If you're
already in a tmux session, the command above is enough. From a plain terminal,
use the launcher, which creates/attaches a dedicated `gc-tui` session:

```bash
npm --workspace tui run start:tmux -- <city>     # or ./tui/start-tmux.sh <city>
```

Env: `DASHBOARD_URL` (default `http://127.0.0.1:8081`), `GC_CITY_NAME` or
`--city=<name>` (required — no silent fallback to a default city). Press `q` to
quit.

## Status

Prototype, not yet wired into root CI `typecheck`. If it graduates, add
`npm --workspace tui run typecheck` to the root `typecheck:src` chain so
shared-DTO changes can't silently break this third consumer.
