import fs from 'node:fs/promises';
import path from 'node:path';
import type { IsoTimestamp, TriageItem } from 'gas-city-dashboard-shared';

// Per-item maintainer-vetted state for the triage view
// (gascity-dashboard-2ax). Stored in a separate JSON file from the
// maintainer cache so it survives the nightly worker rewriting the
// cache. The route handler splices this state onto cached envelopes at
// read time — the cache file itself never holds vetted flags.
//
// Pruning policy: NONE. Closed/reopened items keep their earlier
// vetting. Lifetime growth is one entry per ever-vetted item, which is
// small enough for the single-operator single-repo target.
//
// Concurrency: an in-process Promise-chain mutex serializes
// read-modify-write across simultaneous requests (e.g. two browser
// tabs POSTing within a few ms). The file write itself is atomic via
// tmp+rename, mirroring storage.ts.

export interface TriagedEntry {
  triaged_at: IsoTimestamp;
}

/** State file shape: map from `<kind>:<number>` to entry. */
export type TriagedState = Record<string, TriagedEntry>;

export interface TriagedKey {
  kind: 'pr' | 'issue';
  number: number;
}

export interface SetTriagedResult {
  updated: TriagedKey[];
}

function stateKey(kind: 'pr' | 'issue', number: number): string {
  return `${kind}:${number}`;
}

export async function loadTriagedState(statePath: string): Promise<TriagedState> {
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const out: TriagedState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      const ts = (value as { triaged_at?: unknown }).triaged_at;
      if (typeof ts !== 'string' || ts.length === 0) continue;
      out[key] = { triaged_at: ts };
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    console.warn(`[triaged-state] read failed: ${(err as Error).message}`);
    return {};
  }
}

// One shared chain serializes ALL writes process-wide. The cost of a
// global serialization point is acceptable because writes are rare
// (manual toggle events, not request hot path) and the single-operator
// model rules out cross-process contention.
let writeChain: Promise<unknown> = Promise.resolve();

export async function setTriaged(
  statePath: string,
  items: ReadonlyArray<TriagedKey>,
  triaged: boolean,
): Promise<SetTriagedResult> {
  const task = writeChain.then(async () => {
    const state = await loadTriagedState(statePath);
    const now = new Date().toISOString();
    for (const item of items) {
      const k = stateKey(item.kind, item.number);
      if (triaged) {
        state[k] = { triaged_at: now };
      } else {
        delete state[k];
      }
    }
    await writeAtomic(statePath, state);
    return { updated: items.map((i) => ({ kind: i.kind, number: i.number })) };
  });
  // Keep the chain alive even if this task throws, so the next caller
  // can still acquire the mutex. The `.catch` swallows the error for
  // chain bookkeeping only; the real error still propagates to the
  // awaiting caller via `task`.
  writeChain = task.catch(() => undefined);
  return task;
}

async function writeAtomic(statePath: string, state: TriagedState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await fs.rename(tmp, statePath);
}

/** Mutate `items` in place, splicing `triaged`/`triaged_at` from state. */
export function applyTriagedState(items: TriageItem[], state: TriagedState): void {
  for (const item of items) {
    const entry = state[stateKey(item.kind, item.number)];
    if (entry !== undefined) {
      item.triaged = true;
      item.triaged_at = entry.triaged_at;
    } else {
      item.triaged = false;
      item.triaged_at = null;
    }
  }
}
