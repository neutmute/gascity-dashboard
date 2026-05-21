/**
 * Time formatting helpers shared across routes.
 *
 * `formatRelative` produces compact human-readable durations relative to a
 * caller-supplied `now`. Passing `now` in (rather than calling `Date.now()`
 * internally) lets a parent component drive the tick via `useState(Date.now())`
 * so every relative timestamp in a render is consistent with every other.
 *
 * Output grammar (diffs are rounded to the nearest second before bucketing,
 * so e.g. 4.5s renders as '5s', not 'now'):
 *   '·'    — invalid / missing / null input (interpunct sentinel; see DESIGN.md)
 *   'now'  — rounded diff < 5 seconds (future timestamps clamp to 0)
 *   'Ns'   — rounded diff in [5s, 60s)
 *   'Nm'   — rounded diff in [1m, 1h)
 *   'Nh'   — rounded diff in [1h, 24h)
 *   'Nd'   — rounded diff ≥ 24h
 */
export function formatRelative(
  ts: string | number | Date | undefined | null,
  now: number,
): string {
  if (ts === undefined || ts === null || ts === '') return '·';

  const ms = ts instanceof Date ? ts.getTime() : typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) return '·';

  const diffSec = Math.max(0, Math.round((now - ms) / 1_000));
  if (diffSec < 5) return 'now';
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3_600) return `${Math.round(diffSec / 60)}m`;
  if (diffSec < 86_400) return `${Math.round(diffSec / 3_600)}h`;
  return `${Math.round(diffSec / 86_400)}d`;
}
