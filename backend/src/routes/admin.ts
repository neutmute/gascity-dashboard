import { Router } from 'express';
import type {
  GcBead,
  GcSession,
  KanbanCard,
  KanbanColumn,
  KanbanResponse,
} from 'gas-city-dashboard-shared';
import { KANBAN_COLUMNS } from 'gas-city-dashboard-shared';
import { GcClient } from '../gc-client.js';
import { execBdListClosed, ExecError } from '../exec.js';
import { recordAudit } from '../audit.js';

// Admin surface — the Kanban view (gascity-dashboard-dh6). Ported from
// Wldc4rd/citadel; behavior preserved, visual register lives in the
// frontend (DESIGN.md treatment). Read-only — no drag-drop, no inline
// edits. Cards link into /beads in the v0 (no drill-in route yet).

const KANBAN_TITLE_CAP = 120;
const KANBAN_STALL_MS = 60 * 60 * 1_000; // 1h: in-flight vs stalled threshold
const KANBAN_CLOSED_WINDOW_MS = 24 * 60 * 60 * 1_000;

// v0 spam filter — mirrors routes/beads.ts::defaultBeadFilter so the
// Kanban counts match the Beads view. Duplicated intentionally; the
// definition of "engineering work" is co-located with each endpoint
// that asks the question.
const ENG_TYPES = new Set(['feature', 'bug', 'task', 'docs']);
function isEngBead(bead: GcBead): boolean {
  if (!ENG_TYPES.has(bead.issue_type)) return false;
  if (bead.labels?.some((l) => l.startsWith('gc:'))) return false;
  return true;
}

/**
 * One dependency edge as supervisor returns it inline on each bead.
 * The shared GcBead type doesn't enumerate this field (supervisor wire
 * shape varies); we read it through a narrow local cast rather than
 * widening the type contract.
 */
interface BeadDependencyEdge {
  depends_on_id?: string;
}

function readDeps(bead: GcBead): ReadonlyArray<BeadDependencyEdge> {
  const raw = (bead as unknown as { dependencies?: unknown }).dependencies;
  return Array.isArray(raw) ? (raw as BeadDependencyEdge[]) : [];
}

/**
 * Map a bead → its Kanban column (or null to omit). Uses session
 * activity to distinguish in_flight vs stalled. Uses open-bead-id set
 * membership of each blocked bead's deps to distinguish blocked_real
 * vs blocked_stale.
 */
function classifyKanban(
  bead: GcBead,
  sessionByAssignee: Map<string, GcSession>,
  openBeadIds: Set<string>,
  now: number,
  closedAtById: Map<string, string>,
): KanbanColumn | null {
  if (bead.status === 'closed') {
    const ca = closedAtById.get(bead.id);
    if (!ca) return null;
    const ms = Date.parse(ca);
    if (!Number.isFinite(ms) || now - ms > KANBAN_CLOSED_WINDOW_MS) return null;
    return 'closed_24h';
  }

  const labels = bead.labels ?? [];
  // Label-driven pipeline states take precedence over status.
  if (labels.includes('approved')) return 'approved';
  if (labels.includes('needs-changes')) return 'needs_changes';
  if (labels.includes('needs-review')) return 'in_review';
  if (labels.includes('blocked') || bead.status === 'blocked') {
    // blocked_real: any dep still active (membership of openBeadIds).
    // blocked_stale: all deps resolved → operator needs to unblock.
    const deps = readDeps(bead);
    if (deps.length === 0) return 'blocked_stale';
    const anyOpen = deps.some(
      (d) => typeof d.depends_on_id === 'string' && openBeadIds.has(d.depends_on_id),
    );
    return anyOpen ? 'blocked_real' : 'blocked_stale';
  }

  // Active-work states.
  if (bead.status === 'in_progress') {
    const sess = bead.assignee ? sessionByAssignee.get(bead.assignee) : undefined;
    const lastActive = sess?.last_active ? Date.parse(sess.last_active) : NaN;
    if (
      sess &&
      sess.state === 'active' &&
      Number.isFinite(lastActive) &&
      now - lastActive < KANBAN_STALL_MS
    ) {
      return 'in_flight';
    }
    return 'stalled';
  }

  if (bead.status === 'open') return 'mayor_plate';
  return null;
}

function lastActiveForBead(
  bead: GcBead,
  sessionByAssignee: Map<string, GcSession>,
): string | null {
  const sess = bead.assignee ? sessionByAssignee.get(bead.assignee) : undefined;
  const sessLast = sess?.last_active ?? null;
  const beadLast = bead.updated_at ?? bead.created_at;
  if (sessLast && beadLast) {
    return sessLast > beadLast ? sessLast : beadLast;
  }
  return sessLast ?? beadLast ?? null;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function toKanbanCard(
  bead: GcBead,
  sessionByAssignee: Map<string, GcSession>,
  openBeadIds: Set<string>,
): KanbanCard {
  const deps = readDeps(bead);
  const openBlockerCount = deps.filter(
    (d) => typeof d.depends_on_id === 'string' && openBeadIds.has(d.depends_on_id),
  ).length;
  return {
    id: bead.id,
    title: truncate(bead.title ?? '', KANBAN_TITLE_CAP),
    assignee: bead.assignee ?? '',
    last_active: lastActiveForBead(bead, sessionByAssignee),
    open_blocker_count: openBlockerCount,
    priority: typeof bead.priority === 'number' ? bead.priority : 4,
  };
}

function cmpIso(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildKanban(
  openBeads: ReadonlyArray<GcBead>,
  closedBeads: ReadonlyArray<GcBead>,
  sessions: ReadonlyArray<GcSession>,
  now: Date,
): KanbanResponse {
  // Index sessions by every alias-ish field. Bead assignees use mixed
  // formats (alias / session_name / id) so each session gets entered
  // under each identifier the bead store may quote.
  const sessionByAssignee = new Map<string, GcSession>();
  for (const s of sessions) {
    if (s.alias) sessionByAssignee.set(s.alias, s);
    if (s.session_name) sessionByAssignee.set(s.session_name, s);
    sessionByAssignee.set(s.id, s);
  }
  const openBeadIds = new Set<string>(openBeads.map((b) => b.id));
  const closedAtById = new Map<string, string>();
  for (const b of closedBeads) {
    if (b.closed_at) closedAtById.set(b.id, b.closed_at);
  }

  const cols: Record<KanbanColumn, KanbanCard[]> = {
    mayor_plate: [],
    in_flight: [],
    stalled: [],
    blocked_real: [],
    blocked_stale: [],
    in_review: [],
    needs_changes: [],
    approved: [],
    closed_24h: [],
  };
  const nowMs = now.getTime();

  for (const bead of openBeads) {
    if (!isEngBead(bead)) continue;
    const col = classifyKanban(bead, sessionByAssignee, openBeadIds, nowMs, closedAtById);
    if (col === null) continue;
    cols[col].push(toKanbanCard(bead, sessionByAssignee, openBeadIds));
  }
  for (const bead of closedBeads) {
    if (!isEngBead(bead)) continue;
    const col = classifyKanban(bead, sessionByAssignee, openBeadIds, nowMs, closedAtById);
    if (col === null) continue;
    cols[col].push(toKanbanCard(bead, sessionByAssignee, openBeadIds));
  }

  // Sort each column. closed_24h is most-recent first; other columns
  // are priority ascending (P0 first), then last_active descending.
  for (const c of KANBAN_COLUMNS) {
    cols[c].sort((a, b) => {
      if (c === 'closed_24h') return cmpIso(b.last_active, a.last_active);
      if (a.priority !== b.priority) return a.priority - b.priority;
      return cmpIso(b.last_active, a.last_active);
    });
  }

  const total = KANBAN_COLUMNS.reduce((sum, c) => sum + cols[c].length, 0);
  return { as_of: now.toISOString(), columns: cols, total };
}

export function adminRouter(gc: GcClient, cityPath: string): Router {
  const router = Router();

  router.get('/kanban', async (_req, res) => {
    try {
      // Three parallel sources: open beads (supervisor /beads), recent
      // closures (bd CLI shell-exec for the 24h window — supervisor
      // omits closed_at), and sessions (in-flight vs stalled).
      const closedAfter = new Date(Date.now() - KANBAN_CLOSED_WINDOW_MS).toISOString();
      const [openResp, sessionResp, closedExec] = await Promise.all([
        gc.listBeads(undefined, { limit: 1000 }),
        gc.listSessions(),
        cityPath.length > 0
          ? execBdListClosed(cityPath, closedAfter, 500)
          : Promise.resolve(null),
      ]);
      let closedBeads: GcBead[] = [];
      let closedDurationMs = 0;
      if (closedExec !== null) {
        closedDurationMs = closedExec.durationMs;
        if (closedExec.exitCode === 0 && closedExec.stdout.length > 0) {
          try {
            const parsed = JSON.parse(closedExec.stdout);
            if (Array.isArray(parsed)) closedBeads = parsed as GcBead[];
          } catch {
            // Partial failure is fine — the rest of the board still renders.
          }
        }
      }
      const payload = buildKanban(
        openResp.items,
        closedBeads,
        sessionResp.items,
        new Date(),
      );
      void recordAudit({
        type: 'dashboard.fetch',
        endpoint: 'GET /api/admin/kanban',
        parsed_args: {
          open_count: String(openResp.items.length),
          closed_count: String(closedBeads.length),
          session_count: String(sessionResp.items.length),
        },
        duration_ms: closedDurationMs,
      });
      res.json(payload);
    } catch (err) {
      if (err instanceof ExecError) {
        res.status(err.kind === 'timeout' ? 504 : 500).json({
          error: err.message,
          kind: err.kind,
        });
        return;
      }
      if (GcClient.isTimeoutError(err)) {
        res.status(504).json({
          error: 'gc supervisor did not respond in time',
          kind: 'upstream-timeout',
        });
        return;
      }
      res.status(502).json({
        error: 'failed to compute kanban',
        kind: 'upstream',
        details: { message: (err as Error).message },
      });
    }
  });

  return router;
}
