import { useCallback, useEffect, useState } from 'react';
import type {
  ContributorStat,
  ContributorTier,
  MaintainerTriage,
  TriageCluster,
  TriageItem,
  TriageItemStatus,
  TriageTier,
  TriageTierSection,
} from 'gas-city-dashboard-shared';
import { api } from '../api/client';
import { setCached } from '../api/cache';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { useCachedData } from '../hooks/useCachedData';

// Triage route — read-only maintainer surface for gastownhall/gascity.
// Shell + tokens from gascity-dashboard-hq2; live data from
// gascity-dashboard-361 (gh ingest + JSON cache). Enrichment lands in
// 7ts (priority tiers), gtr (file clusters + blast radius), alh
// (contributor trust + ratios), and 98h (semantic weak ties).

const CACHE_KEY = 'maintainer-triage';
const COLLAPSE_KEY = 'maintainer:collapsed';
const FOCUS_KEY = 'maintainer:focusBreaking';

// Persists which tier / cluster headings the operator has collapsed.
// Set of ids; default empty (all expanded). LocalStorage-backed so the
// preference holds across the page being open in an ambient tab.
function useCollapseState() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
    } catch {
      return new Set();
    }
  });

  const persist = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      /* quota / disabled storage — fine to skip */
    }
  }, []);

  const toggle = useCallback(
    (id: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setExact = useCallback(
    (ids: Iterable<string>) => {
      const next = new Set(ids);
      persist(next);
      setCollapsed(next);
    },
    [persist],
  );

  return { isCollapsed: (id: string) => collapsed.has(id), toggle, setExact };
}

export function MaintainerPage() {
  const { data, loading, error, refresh } = useCachedData<MaintainerTriage>(
    CACHE_KEY,
    () => api.maintainerTriage(),
  );

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const collapse = useCollapseState();
  const [focusBreaking, setFocusBreaking] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FOCUS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleFocus = useCallback(() => {
    setFocusBreaking((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(FOCUS_KEY, next ? '1' : '0');
      } catch {
        /* skip */
      }
      return next;
    });
  }, []);

  // Live updates: subscribe to /api/maintainer/events. Whenever the
  // nightly worker (or anyone else's manual refresh) rewrites the
  // cache, the server fires a 'refreshed' event and we refetch. The
  // EventSource browser API auto-reconnects with backoff; only the
  // mount/unmount lifecycle needs manual handling here.
  useEffect(() => {
    const es = new EventSource('/api/maintainer/events');
    const onRefresh = () => {
      void refresh();
    };
    es.addEventListener('refreshed', onRefresh);
    return () => {
      es.removeEventListener('refreshed', onRefresh);
      es.close();
    };
  }, [refresh]);

  // POST /maintainer/refresh runs the full gh fetch on the host and
  // rewrites the JSON cache. This is the dev-time path; the nightly
  // worker (bead ar9) will replace the manual button as the primary
  // cache writer.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const fresh = await api.maintainerRefresh();
      setCached(CACHE_KEY, fresh);
      await refresh();
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // Per-row toggle: flip the maintainer-vetted state for a single item.
  // Server persists in a state file (gascity-dashboard-2ax) and fires an
  // SSE 'refreshed' event so the page refetches and re-renders. The
  // optimistic-update path is skipped on purpose; SSE round-trip is
  // ~tens of ms locally and avoids any in-flight desync.
  const toggleTriaged = useCallback(
    (item: TriageItem) => {
      void (async () => {
        try {
          await api.maintainerSetTriaged(
            [{ kind: item.kind, number: item.number }],
            !item.triaged,
          );
        } catch (err) {
          setRefreshError(err instanceof Error ? err.message : 'mark triaged failed');
        }
      })();
    },
    [setRefreshError],
  );

  return (
    <section>
      <PageHeader
        title="Triage"
        synopsis={data ? buildSynopsis(data) : 'Reading triage from cache.'}
        meta={
          <>
            {(error || refreshError) && (
              <span className="normal-case text-body text-accent" role="alert">
                {refreshError ?? error}
              </span>
            )}
            <Button size="sm" onClick={toggleFocus}>
              {focusBreaking ? 'Show all tiers' : 'Breaking only'}
            </Button>
            <Button size="sm" onClick={() => void handleRefresh()} disabled={refreshing}>
              {refreshing ? 'Refreshing' : 'Refresh from gh'}
            </Button>
            <span className="text-fg-muted tnum normal-case tracking-normal">
              {formatDate(new Date())}
            </span>
          </>
        }
      />

      {data ? (
        <>
          <div className="space-y-14">
            {data.tiers
              .filter((tier) => !focusBreaking || tier.tier === 'regression_breaking')
              .map((tier) => (
                <TierSection
                  key={tier.tier}
                  section={tier}
                  collapsed={collapse.isCollapsed(`tier:${tier.tier}`)}
                  onToggle={() => collapse.toggle(`tier:${tier.tier}`)}
                  isCollapsed={collapse.isCollapsed}
                  toggleCluster={collapse.toggle}
                  onToggleTriaged={toggleTriaged}
                />
              ))}
          </div>
          <Footer computedAt={data.computed_at} />
        </>
      ) : loading ? (
        <p className="text-body text-fg-muted italic">Loading.</p>
      ) : (
        <p className="text-body text-fg-faint italic">
          No triage cache yet. Click <span className="text-fg">Refresh from gh</span> to fetch.
        </p>
      )}
    </section>
  );
}

function TierSection({
  section,
  collapsed,
  onToggle,
  isCollapsed,
  toggleCluster,
  onToggleTriaged,
}: {
  section: TriageTierSection;
  collapsed: boolean;
  onToggle: () => void;
  isCollapsed: (id: string) => boolean;
  toggleCluster: (id: string) => void;
  onToggleTriaged: (item: TriageItem) => void;
}) {
  const itemCount =
    section.clusters.reduce((n, c) => n + c.items.length, 0) +
    section.unclustered.length;

  return (
    <section>
      <header className="mb-6 pb-2 border-b border-rule">
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-baseline justify-between gap-4 focus-mark"
          aria-expanded={!collapsed}
        >
          <h2
            className={
              section.tier === 'regression_breaking'
                ? 'text-headline font-semibold uppercase tracking-wide text-fg text-left'
                : 'text-headline font-semibold uppercase tracking-wide text-fg-muted text-left'
            }
          >
            <CollapseGlyph collapsed={collapsed} />
            {tierLabel(section.tier)}
          </h2>
          <span className="text-label uppercase tracking-wider text-fg-muted tnum">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
        </button>
      </header>

      {collapsed ? null : section.clusters.length === 0 && section.unclustered.length === 0 ? (
        <p className="text-body text-fg-faint italic">No items in this tier.</p>
      ) : (
        <div className="space-y-10">
          {section.clusters.map((cluster) => (
            <ClusterBlock
              key={cluster.cluster_id}
              cluster={cluster}
              collapsed={isCollapsed(`cluster:${cluster.cluster_id}`)}
              onToggle={() => toggleCluster(`cluster:${cluster.cluster_id}`)}
              onToggleTriaged={onToggleTriaged}
            />
          ))}

          {section.unclustered.length > 0 && (
            <div className="space-y-2">
              <div className="text-title font-medium text-fg-muted">
                {section.clusters.length > 0 ? 'Unclustered' : 'Awaiting cluster enrichment'}
              </div>
              <RowList items={section.unclustered} onToggleTriaged={onToggleTriaged} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CollapseGlyph({ collapsed }: { collapsed: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block text-fg-faint mr-2 transition-transform duration-150 ease-out-quart"
      style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
    >
      ▾
    </span>
  );
}

function ClusterBlock({
  cluster,
  collapsed,
  onToggle,
  onToggleTriaged,
}: {
  cluster: TriageCluster;
  collapsed: boolean;
  onToggle: () => void;
  onToggleTriaged: (item: TriageItem) => void;
}) {
  const issues = cluster.items.filter((i) => i.kind === 'issue').length;
  const prs = cluster.items.filter((i) => i.kind === 'pr').length;
  const totals: string[] = [];
  if (issues > 0) totals.push(`${issues} ${issues === 1 ? 'issue' : 'issues'}`);
  if (prs > 0) totals.push(`${prs} ${prs === 1 ? 'PR' : 'PRs'}`);
  if (cluster.lines_pending > 0) totals.push(`${cluster.lines_pending} lines pending`);

  // cluster.files entries prefixed with `@topic/` come from the
  // keyword-clustering pass and read as a subsystem name, not a path.
  // Render them as a small uppercase-tracked label so they don't
  // pretend to be file paths.
  const isTopic = cluster.files.every((f) => f.startsWith('@topic/'));
  const headerLabel = isTopic
    ? cluster.files.map((f) => f.replace(/^@topic\//, '')).join(', ')
    : cluster.files.join(', ');

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="w-full flex items-baseline justify-between gap-4 focus-mark text-left"
      >
        <div
          className={
            isTopic
              ? 'text-label uppercase tracking-wider font-medium text-fg-muted min-w-0 truncate'
              : 'text-title font-medium text-fg min-w-0 truncate'
          }
        >
          <CollapseGlyph collapsed={collapsed} />
          {isTopic && (
            <span className="text-fg-faint mr-2" aria-hidden>·</span>
          )}
          {headerLabel}
        </div>
        <div className="text-body text-fg-muted tnum shrink-0">
          {totals.join(' · ')}
        </div>
      </button>
      {!collapsed && <RowList items={cluster.items} onToggleTriaged={onToggleTriaged} />}
    </div>
  );
}

// Lays out a list of items, nesting PRs under their parent issue when
// the parent is also in the same list. PRs whose linked issue is NOT
// in the list render at the top level alongside issues, distinguished
// by a leading "PR" kind marker. The reverse-mapped issue.linked_numbers
// (populated server-side in triage.ts) drives the "anchored" affordance
// on issues.
function RowList({
  items,
  onToggleTriaged,
}: {
  items: TriageItem[];
  onToggleTriaged: (item: TriageItem) => void;
}) {
  const issueNumbersInList = new Set<number>();
  for (const it of items) {
    if (it.kind === 'issue') issueNumbersInList.add(it.number);
  }

  const nestedPrNumbers = new Set<number>();
  const childrenOf = new Map<number, TriageItem[]>();
  for (const it of items) {
    if (it.kind !== 'pr') continue;
    for (const linked of it.linked_numbers) {
      if (issueNumbersInList.has(linked)) {
        nestedPrNumbers.add(it.number);
        const list = childrenOf.get(linked);
        if (list) list.push(it);
        else childrenOf.set(linked, [it]);
      }
    }
  }

  return (
    <div>
      {items.map((it) => {
        if (it.kind === 'pr' && nestedPrNumbers.has(it.number)) return null;
        const children = it.kind === 'issue' ? childrenOf.get(it.number) ?? [] : [];
        return (
          <div key={rowKey(it)}>
            {it.kind === 'issue' ? (
              <IssueRow
                item={it}
                hasInListChildren={children.length > 0}
                onToggleTriaged={onToggleTriaged}
              />
            ) : (
              <PrRow item={it} nested={false} onToggleTriaged={onToggleTriaged} />
            )}
            {children.map((child) => (
              <PrRow
                key={rowKey(child)}
                item={child}
                nested={true}
                onToggleTriaged={onToggleTriaged}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function IssueRow({
  item,
  hasInListChildren,
  onToggleTriaged,
}: {
  item: TriageItem;
  hasInListChildren: boolean;
  onToggleTriaged: (item: TriageItem) => void;
}) {
  // 'anchored' only lights up when the linked PR is NOT also in view —
  // when it IS in view, the visual nesting already communicates the
  // link and the label would be noise.
  const showAnchored = item.linked_numbers.length > 0 && !hasInListChildren;
  return (
    <div className="grid grid-cols-[1.75em_2.25em_1fr_auto] items-baseline gap-x-3 py-1.5">
      <span aria-hidden className="text-accent text-[0.85em] leading-none translate-y-[1px]">
        {item.is_marked ? '●' : ''}
      </span>
      <PriorityBadge labels={item.labels} />
      <div className="min-w-0">
        <UntriagedGlyph item={item} />
        <span className="text-body text-fg">{item.title}</span>
        {item.weak_ties.length > 0 && (
          <span className="ml-3 text-body text-fg-faint">
            also in: {item.weak_ties.map((t) => `${t.label} (${t.count})`).join(', ')}
          </span>
        )}
        {showAnchored && (
          <span className="ml-3 text-label uppercase tracking-wider text-fg-faint">
            anchored
          </span>
        )}
      </div>
      <RowMeta item={item} onToggleTriaged={onToggleTriaged} />
    </div>
  );
}

function PrRow({
  item,
  nested,
  onToggleTriaged,
}: {
  item: TriageItem;
  nested: boolean;
  onToggleTriaged: (item: TriageItem) => void;
}) {
  // Three visual states:
  //   - Standalone PR, marked    → maroon ● in leading col (rare)
  //   - Standalone PR, unmarked  → "PR" label in leading col
  //   - Nested PR                → '↳' continuation glyph + pl-10 indent
  //     (urgency is the parent issue's, so no maroon mark even when
  //     is_marked — the parent above already carries the One Mark)
  const leading = nested ? (
    <span className="text-fg-faint leading-none translate-y-[1px]" aria-label="fixes issue above">↳</span>
  ) : item.is_marked ? (
    <span className="text-accent text-[0.85em] leading-none translate-y-[1px]" aria-hidden>●</span>
  ) : (
    <span
      className="text-label uppercase tracking-wider text-fg-muted leading-none translate-y-[1px]"
      aria-label="pull request"
    >
      PR
    </span>
  );

  return (
    <div
      className={`grid grid-cols-[1.75em_2.25em_1fr_auto] items-baseline gap-x-3 py-1 ${nested ? 'pl-10' : ''}`}
    >
      {leading}
      <PriorityBadge labels={item.labels} />
      <div className="min-w-0">
        <UntriagedGlyph item={item} />
        <span className={nested ? 'text-body text-fg-muted' : 'text-body text-fg'}>
          {item.title}
        </span>
        {item.weak_ties.length > 0 && (
          <span className="ml-3 text-body text-fg-faint">
            also in: {item.weak_ties.map((t) => `${t.label} (${t.count})`).join(', ')}
          </span>
        )}
      </div>
      <RowMeta
        item={item}
        extraStatus={item.status}
        onToggleTriaged={onToggleTriaged}
      />
    </div>
  );
}

// Leading '?' glyph for items the maintainer has NOT explicitly vetted
// (triage_score remains a heuristic — the '?' marks "this number is a
// guess, not your considered judgment"). Suppressed when is_marked is
// true: the maroon ● already owns the row's attention channel under
// the One Mark Rule.
function UntriagedGlyph({ item }: { item: TriageItem }) {
  if (item.triaged || item.is_marked) return null;
  return (
    <span
      aria-label="not yet triaged by maintainer"
      className="text-fg-faint mr-2"
    >
      ?
    </span>
  );
}

function PriorityBadge({ labels }: { labels: string[] }) {
  const p = extractPriorityLabel(labels);
  if (p === null) return <span aria-hidden />;
  return (
    <span
      className="text-label uppercase tracking-wider text-fg-muted tnum leading-none translate-y-[1px]"
      title={`labeled severity: priority/${p.toLowerCase()}`}
    >
      {p}
    </span>
  );
}

function extractPriorityLabel(labels: string[]): string | null {
  for (const l of labels) {
    const m = /^priority\/(p[0-3])$/i.exec(l);
    if (m && m[1] !== undefined) return m[1].toUpperCase();
  }
  return null;
}

function RowMeta({
  item,
  extraStatus,
  onToggleTriaged,
}: {
  item: TriageItem;
  extraStatus?: TriageItemStatus;
  onToggleTriaged: (item: TriageItem) => void;
}) {
  return (
    <div className="flex items-baseline gap-3 text-body text-fg-muted shrink-0 tnum">
      <a
        href={item.html_url}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-fg focus-mark"
      >
        #{item.number}
      </a>
      {item.triage_score !== null && (
        <>
          <span aria-hidden>·</span>
          <span
            className="text-fg-faint"
            title="triage score = severity_base + simplicity_bonus; higher = should land sooner"
          >
            t{item.triage_score}
          </span>
        </>
      )}
      <span aria-hidden>·</span>
      <ContributorByline author={item.author} />
      <span aria-hidden>·</span>
      <span>{formatAge(item.updated_at)}</span>
      {extraStatus && extraStatus !== 'open' && (
        <>
          <span aria-hidden>·</span>
          <PrStatus status={extraStatus} />
        </>
      )}
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={() => onToggleTriaged(item)}
        className="text-label uppercase tracking-wider text-fg-faint hover:text-fg focus-mark"
        title={
          item.triaged
            ? 'unmark — re-flag as not yet vetted'
            : 'mark as vetted by maintainer'
        }
      >
        {item.triaged ? 'untriage' : 'mark triaged'}
      </button>
    </div>
  );
}

function PrStatus({ status }: { status: TriageItemStatus }) {
  const label = statusLabel(status);
  const className =
    status === 'approved'
      ? 'text-ok'
      : status === 'changes_requested'
        ? 'text-accent'
        : status === 'needs_review'
          ? 'text-warn'
          : 'text-fg-muted';
  return <span className={className}>{label}</span>;
}

function ContributorByline({ author }: { author: ContributorStat }) {
  const ratesAvailable =
    author.issues_accepted !== null &&
    author.issues_opened !== null &&
    author.prs_merged !== null &&
    author.prs_opened !== null;

  const ratesTitle = ratesAvailable
    ? `${author.issues_accepted}/${author.issues_opened} issues accepted · ${author.prs_merged}/${author.prs_opened} PRs merged`
    : 'rates not yet computed';

  return (
    <span title={ratesTitle} className="whitespace-nowrap">
      {author.login}{' '}
      <span className={tierClass(author.tier)}>{tierWord(author.tier)}</span>
    </span>
  );
}

function Footer({ computedAt }: { computedAt: string | null }) {
  if (computedAt === null) {
    return (
      <p className="mt-16 text-label uppercase tracking-wider text-fg-faint">
        enrichment not yet computed · status data is live
      </p>
    );
  }
  return (
    <p className="mt-16 text-label uppercase tracking-wider text-fg-faint tnum">
      clusters computed {formatTimestamp(computedAt)} · {formatRelative(computedAt)} ago
    </p>
  );
}

// ── derivation helpers ───────────────────────────────────────────────

function rowKey(item: TriageItem): string {
  return `${item.kind}-${item.number}`;
}

function tierLabel(tier: TriageTier): string {
  if (tier === 'regression_breaking') return 'Regression + breaking';
  if (tier === 'regression') return 'Regression';
  return 'Stability';
}

function tierWord(tier: ContributorTier): string {
  if (tier === 'spam_risk') return 'spam risk';
  return tier;
}

function tierClass(tier: ContributorTier): string {
  if (tier === 'core') return 'text-fg font-medium';
  if (tier === 'trusted') return 'text-fg';
  if (tier === 'regular') return 'text-fg-muted';
  if (tier === 'new') return 'text-fg-muted italic';
  return 'text-accent';
}

function statusLabel(status: TriageItemStatus): string {
  if (status === 'needs_review') return 'needs review';
  if (status === 'changes_requested') return 'changes requested';
  return status;
}

function buildSynopsis(data: MaintainerTriage): string {
  const breaking = data.tiers.find((t) => t.tier === 'regression_breaking');
  const breakingCount = breaking
    ? breaking.clusters.reduce((n, c) => n + c.items.length, 0) +
      breaking.unclustered.length
    : 0;
  if (breakingCount > 0) {
    return `${breakingCount} item${breakingCount === 1 ? '' : 's'} in regression+breaking. ${data.totals.issues_open} issues, ${data.totals.prs_open} PRs open across ${data.repo}.`;
  }
  if (data.totals.issues_open + data.totals.prs_open === 0) {
    return `Quiet across ${data.repo}.`;
  }
  return `${data.totals.issues_open} issues, ${data.totals.prs_open} PRs open across ${data.repo}. Awaiting tier classification.`;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
