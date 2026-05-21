import { describe, expect, it } from 'vitest';
import type { KanbanCard, KanbanColumn, KanbanResponse } from 'gas-city-dashboard-shared';
import { detectMoves } from './kanbanMoves';

const AT = Date.parse('2026-05-20T12:00:00.000Z');

function card(id: string, opts: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id,
    title: opts.title ?? `Title for ${id}`,
    assignee: opts.assignee ?? '',
    last_active: opts.last_active ?? null,
    open_blocker_count: opts.open_blocker_count ?? 0,
    priority: opts.priority ?? 2,
  };
}

function emptyColumns(): Record<KanbanColumn, KanbanCard[]> {
  return {
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
}

function snapshot(
  placements: Partial<Record<KanbanColumn, KanbanCard[]>>,
): KanbanResponse {
  const columns = emptyColumns();
  for (const [col, cards] of Object.entries(placements)) {
    columns[col as KanbanColumn] = cards ?? [];
  }
  const total = Object.values(columns).reduce((n, cs) => n + cs.length, 0);
  return {
    as_of: new Date(AT).toISOString(),
    columns,
    total,
  };
}

describe('detectMoves', () => {
  it('returns [] when prev is null (initial load)', () => {
    const next = snapshot({ in_flight: [card('bead-1')] });
    expect(detectMoves(null, next, AT)).toEqual([]);
  });

  it('returns [] when snapshots are identical', () => {
    const a = snapshot({ in_flight: [card('bead-1')], mayor_plate: [card('bead-2')] });
    const b = snapshot({ in_flight: [card('bead-1')], mayor_plate: [card('bead-2')] });
    expect(detectMoves(a, b, AT)).toEqual([]);
  });

  it('detects a single column transition', () => {
    const prev = snapshot({ mayor_plate: [card('bead-1', { title: 'one' })] });
    const next = snapshot({ in_flight: [card('bead-1', { title: 'one' })] });
    const moves = detectMoves(prev, next, AT);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      id: 'bead-1',
      from: 'mayor_plate',
      to: 'in_flight',
      title: 'one',
      at: AT,
    });
  });

  it('uses the new snapshot title (move record reflects current state)', () => {
    const prev = snapshot({ mayor_plate: [card('bead-1', { title: 'old' })] });
    const next = snapshot({ in_flight: [card('bead-1', { title: 'new' })] });
    expect(detectMoves(prev, next, AT)[0].title).toBe('new');
  });

  it('does not emit a move when title changes but column is the same', () => {
    const prev = snapshot({ in_flight: [card('bead-1', { title: 'old' })] });
    const next = snapshot({ in_flight: [card('bead-1', { title: 'new' })] });
    expect(detectMoves(prev, next, AT)).toEqual([]);
  });

  it('does not synthesize a phantom move when a bead leaves the board entirely', () => {
    // bead-1 was in closed_24h, then aged out of the 24h window. No new
    // column hosts it. That is not a column transition the operator
    // cares about.
    const prev = snapshot({ closed_24h: [card('bead-1')] });
    const next = snapshot({});
    expect(detectMoves(prev, next, AT)).toEqual([]);
  });

  it('does not synthesize a phantom move for a newly-appeared bead', () => {
    // bead-2 wasn't on the previous board (just created). Not a move.
    const prev = snapshot({});
    const next = snapshot({ mayor_plate: [card('bead-2')] });
    expect(detectMoves(prev, next, AT)).toEqual([]);
  });

  it('detects multiple moves in one diff', () => {
    const prev = snapshot({
      mayor_plate: [card('bead-1')],
      in_flight: [card('bead-2')],
      in_review: [card('bead-3')],
    });
    const next = snapshot({
      in_flight: [card('bead-1')],
      stalled: [card('bead-2')],
      approved: [card('bead-3')],
    });
    const moves = detectMoves(prev, next, AT);
    expect(moves).toHaveLength(3);
    const byId = Object.fromEntries(moves.map((m) => [m.id, m]));
    expect(byId['bead-1']).toMatchObject({ from: 'mayor_plate', to: 'in_flight' });
    expect(byId['bead-2']).toMatchObject({ from: 'in_flight', to: 'stalled' });
    expect(byId['bead-3']).toMatchObject({ from: 'in_review', to: 'approved' });
  });

  it('attaches the supplied at timestamp to every emitted move', () => {
    const prev = snapshot({ mayor_plate: [card('bead-1')] });
    const next = snapshot({ in_flight: [card('bead-1')] });
    const moves = detectMoves(prev, next, 1_700_000_000_000);
    expect(moves[0].at).toBe(1_700_000_000_000);
  });

  it('assigns a unique move id derived from bead id + at + to', () => {
    const prev = snapshot({ mayor_plate: [card('bead-1')] });
    const next = snapshot({ in_flight: [card('bead-1')] });
    const moves = detectMoves(prev, next, AT);
    expect(typeof moves[0].moveId).toBe('string');
    expect(moves[0].moveId.length).toBeGreaterThan(0);
    expect(moves[0].moveId).toContain('bead-1');
  });

  // Defense against a malformed gc supervisor snapshot. The classifier is
  // expected to place each bead in exactly one column, but if it ever
  // emits the same id in two columns we want a deterministic outcome
  // (first column wins) rather than map-insertion-order dependency.
  // The "first column" both tests below refer to is the first appearance in
  // `emptyColumns()` declaration order (in_flight before stalled). `indexById`
  // iterates `Object.entries(snapshot.columns)`, which preserves the literal's
  // insertion order under V8; if `emptyColumns()` is ever reordered, expected
  // `from`/`to` values below shift accordingly. The point of these tests is
  // determinism, not the specific column chosen.
  it('treats the first column as authoritative when the same id appears twice in next', () => {
    const prev = snapshot({ mayor_plate: [card('bead-1', { title: 'one' })] });
    // bead-1 appears in BOTH in_flight and stalled in the next snapshot.
    // `in_flight` comes first in emptyColumns() order, so first-wins should
    // report the move as mayor_plate -> in_flight.
    const next = snapshot({
      in_flight: [card('bead-1', { title: 'one' })],
      stalled: [card('bead-1', { title: 'one' })],
    });
    const moves = detectMoves(prev, next, AT);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      id: 'bead-1',
      from: 'mayor_plate',
      to: 'in_flight',
    });
  });

  it('treats the first column as authoritative when the same id appears twice in prev', () => {
    // Symmetric case: malformed prev snapshot. First-wins keeps `from` stable
    // (anchored to emptyColumns() order) instead of depending on the order
    // V8 happened to iterate Object.entries.
    const prev = snapshot({
      in_flight: [card('bead-1', { title: 'one' })],
      stalled: [card('bead-1', { title: 'one' })],
    });
    const next = snapshot({ approved: [card('bead-1', { title: 'one' })] });
    const moves = detectMoves(prev, next, AT);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      id: 'bead-1',
      from: 'in_flight',
      to: 'approved',
    });
  });
});
