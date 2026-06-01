import { spawnSync } from 'node:child_process';

// gc session ids / aliases are conservative tokens; validate before any value
// reaches a shell-interpreted tmux command (defence in depth — no injection).
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
// City root is a filesystem path; allow path chars only.
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

export function insideTmux(): boolean {
  return Boolean(process.env.TMUX);
}

export interface PeekResult {
  readonly ok: boolean;
  /** tmux pane id of the peek pane (e.g. "%7"), set on a successful open. */
  readonly paneId?: string;
  readonly error?: string;
}

/**
 * Builds the follow command. READS the agent's log (`gc session logs -f`) — it
 * does NOT attach as a second tmux client, so it cannot resize or disturb the
 * running agent. `--city` is explicit because the pane inherits the TUI's cwd,
 * which is usually not a city directory.
 */
function buildCommand(sessionId: string, cityRoot: string | null): string | { error: string } {
  if (!insideTmux()) {
    return { error: 'not inside tmux — launch with `npm --workspace tui run start:tmux`' };
  }
  if (!SAFE_ID.test(sessionId)) return { error: `unsafe session id: ${sessionId}` };
  if (!cityRoot) return { error: 'city path not loaded yet — retry in a moment' };
  if (!SAFE_PATH.test(cityRoot)) return { error: `unsafe city path: ${cityRoot}` };
  // `; exec $SHELL` keeps the pane open if the follow exits, so an error stays
  // readable instead of the pane vanishing.
  return `gc --city ${cityRoot} session logs ${sessionId} -f; exec $SHELL`;
}

function tmuxFail(r: ReturnType<typeof spawnSync>): string {
  if (r.error) return r.error.message;
  const detail = (r.stderr?.toString() ?? '').trim();
  return `tmux: ${detail || `exit ${r.status}`}`;
}

/** True if a pane with this id currently exists anywhere in the server. */
export function paneExists(paneId: string): boolean {
  const r = spawnSync('tmux', ['list-panes', '-a', '-F', '#{pane_id}'], { encoding: 'utf8' });
  if (r.status !== 0 || typeof r.stdout !== 'string') return false;
  return r.stdout.split('\n').includes(paneId);
}

/** Opens the peek pane beside the dashboard (focus stays on the dashboard). */
export function openPeek(sessionId: string, cityRoot: string | null): PeekResult {
  const built = buildCommand(sessionId, cityRoot);
  if (typeof built !== 'string') return { ok: false, error: built.error };
  // -d: don't move focus. -P -F prints the new pane's id so we can retarget it.
  const r = spawnSync(
    'tmux',
    ['split-window', '-d', '-h', '-l', '45%', '-P', '-F', '#{pane_id}', built],
    { encoding: 'utf8' },
  );
  if (r.error || (typeof r.status === 'number' && r.status !== 0)) {
    return { ok: false, error: tmuxFail(r) };
  }
  return { ok: true, paneId: (r.stdout ?? '').trim() };
}

/** Retargets the existing peek pane to a different agent (reuses one pane). */
export function replacePeek(paneId: string, sessionId: string, cityRoot: string | null): PeekResult {
  const built = buildCommand(sessionId, cityRoot);
  if (typeof built !== 'string') return { ok: false, error: built.error };
  const r = spawnSync('tmux', ['respawn-pane', '-k', '-t', paneId, built], { encoding: 'utf8' });
  if (r.error || (typeof r.status === 'number' && r.status !== 0)) {
    return { ok: false, error: tmuxFail(r) };
  }
  return { ok: true, paneId };
}

/** Closes the peek pane. */
export function closePeek(paneId: string): void {
  spawnSync('tmux', ['kill-pane', '-t', paneId], { stdio: 'ignore' });
}
