# gas-city-dashboard — session notes for Claude

Editorial-typographic ambient dashboard for a single Gas City operator. Read [`PRODUCT.md`](PRODUCT.md) and [`DESIGN.md`](DESIGN.md) at the repo root before any design work. They are the contract; they outrank assumed conventions.

## What this codebase is

Five-view dashboard surfacing live state from a [Gas City](https://github.com/gastownhall/gascity) (`gc`) supervisor running on `http://127.0.0.1:8372`:

- **Agents** — session state, peek modal
- **Beads** — engineering work queue, inline claim/close/nudge
- **Mail** — read any agent's inbox via persistent "Reading as" strip; sends always go from the operator
- **Activity** — commits + dev-deploy log, live SSE updates
- **Health** — supervisor + host + admin process + dolt-noms trend

Stack: Node 20 + Express + TS (backend), React 18 + Vite + Tailwind + Inter Variable (frontend), `gas-city-dashboard-shared` workspace package for wire-shape types.

## The operator

`stephanie` — hardcoded in `frontend/src/contexts/ViewingAsContext.tsx` and `backend/src/audit.ts`. Any "Reading as <X>" state where `X !== stephanie` is impersonation: read-only for mail, no send. The `OPERATOR_ALIAS` constant + `ViewingAs.isOperator` field are the source of truth.

## Standalone repo, no upstream

This codebase was extracted from [Wldc4rd/citadel](https://github.com/Wldc4rd/citadel) for the project shape (security model, wire-shape contract, the systemd-separated-from-supervisor decision). The visual register was rebuilt from scratch via [impeccable](https://impeccable.style/). **There is no upstream to track** — the `origin` remote was removed deliberately. Charlie Coutts's MIT copyright is preserved in `LICENSE` (required); the codebase is otherwise ours.

## Quick start (dev)

```bash
# Source local env (gitignored; defines GC_CITY_NAME, ADMIN_AUDIT_LOG_PATH, etc.)
set -a; . ./.env.local; set +a

# Terminal 1
npm run dev:backend      # :8081

# Terminal 2
npm run dev:frontend     # :5174, proxies /api → :8081
```

For remote dev over SSH: forward port 5174 from the host. The backend is `127.0.0.1`-only by design.

## Design-iteration tooling

`scripts/snap.mjs` is a Playwright headless harness for screenshot-driven iteration:

```bash
node scripts/snap.mjs                 # all 5 routes × both themes → /tmp/cp-snaps/
node scripts/snap.mjs agents          # one route, both themes
node scripts/snap.mjs agents light    # one route, one theme
```

Read the resulting PNGs back into the conversation with the Read tool — Claude sees them as actual images.

`scripts/inspect.mjs <route> <theme>` returns computed-style JSON for the body / headings / panels on a given route. Useful for confirming token resolution after CSS changes.

`scripts/snap-peek.mjs` opens the Peek modal in both themes and captures the post-click state. Logs API calls + status codes so CSRF / origin issues surface in the script output.

## After any visual change

1. `npm --workspace frontend run typecheck` (and `--workspace backend` if you touched backend)
2. `node scripts/snap.mjs <route>` to regenerate snaps
3. Read the PNG in to your conversation context
4. Compare against `DESIGN.md` — especially **The One Mark Rule**, **The Flat Page Rule**, **The One Voice Rule**, **The Greyscale Test**

If you've materially changed the visual system, re-run `/impeccable document` afterward to regenerate `DESIGN.md` from the actual implementation.

## Cache traps to know

- **Tailwind config changes need a full Vite restart**, not just HMR. The JIT cache in `node_modules/.vite/` will serve stale class definitions until you `rm -rf node_modules/.vite && npm run dev:frontend`.
- **Vite proxy `changeOrigin: true`** is wired in `vite.config.ts` so write requests carry `Origin: http://127.0.0.1:8081` and pass the backend's allow-list. Don't undo it.

## Style absolutes (from DESIGN.md, summarised)

- No em dashes in UI copy. Commas, colons, semicolons, periods, parentheses. (Interpunct `·` is fine for missing-data sentinels.)
- No `#000` / `#fff` — every neutral tints toward hue 75 (warm amber).
- No side-stripe borders > 1px as a colored accent.
- No gradient text, no glassmorphism, no card-grid hero metrics.
- No bordered cards as a structural default — sections separated by space + type, not by containers.
- One typeface family (Inter Variable). No serif accent, no monospace except inside Peek's ANSI-rendered transcript blocks.
- Tabular figures on every column of numbers (`.tnum` utility).

## Layout

```
PRODUCT.md, DESIGN.md, README.md, LICENSE   # design + project docs at root
shared/                                      # gas-city-dashboard-shared (types)
backend/src/{server.ts, routes/, middleware/, gc-client.ts, exec.ts, audit.ts}
frontend/src/{components/, contexts/, hooks/, routes/, styles/, api/}
scripts/{snap,snap-peek,inspect}.mjs         # design iteration harness
deploy/gas-city-dashboard.service            # systemd unit (templated via %h)
docs/{ARCHITECTURE, SECURITY, EXTENDING}.md
```

## When in doubt

- Visual decision? Re-read `DESIGN.md`. The Named Rules are designed to be quotable.
- Strategic decision (what to build, who it's for)? Re-read `PRODUCT.md`.
- Technical decision (how a thing is wired)? `docs/ARCHITECTURE.md`.
- Adding a new route or backend endpoint? `docs/EXTENDING.md`.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
