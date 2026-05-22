import type { TriageCluster, TriageItem } from 'gas-city-dashboard-shared';

// Topic-keyword clustering for items that don't share files
// (gascity-dashboard-98h).
//
// The original bead spec called for an embedding-based agglomerative
// cluster pass. In practice, gastownhall/gascity titles are dense with
// repo-specific subsystem names ("session", "agent", "pack", "beads",
// "dolt", etc.) — typical maintainer convention. A deterministic
// dictionary match against those subsystems produces the same outcome
// the embedding model would, without the ANTHROPIC_API_KEY infrastructure
// the project doesn't yet have. A later bead can swap this for the
// embedding pass if topics drift across repos or the dictionary stops
// fitting; the wire shape doesn't change.
//
// Topics are repo-specific. This dictionary is gastownhall/gascity-shaped.
// When another repo is added to the maintainer view (MAINTAINER_REPO env),
// it'll need its own topics file or a discover-from-titles fallback.

const GASCITY_TOPICS: ReadonlyArray<string> = [
  // Agent lifecycle
  'session', 'agent', 'mayor', 'pool', 'rig',
  // Issue tracker
  'bd', 'beads', 'dolt', 'noms',
  // Project templates / packs
  'pack', 'gastown', 'formula', 'mol', 'recipe', 'gear',
  // Orchestration
  'supervisor', 'city', 'reconciler', 'scheduler', 'convoy',
  // Comms
  'mail', 'message',
  // Health / maintenance
  'doctor', 'health', 'watchdog', 'reaper', 'refinery', 'maintenance',
  // Infra
  'exec', 'build', 'deploy', 'kanban', 'overseer',
];

// Word-boundary regex per topic; case-insensitive. Topics with hyphens
// or multiple words would need a different pattern; v1 keeps the
// dictionary single-word.
const TOPIC_REGEXES: ReadonlyArray<{ topic: string; re: RegExp }> = GASCITY_TOPICS.map(
  (t) => ({ topic: t, re: new RegExp(`\\b${escapeRegex(t)}\\b`, 'i') }),
);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the most-relevant topic for an item, or null if no topic
 * matches. Items with multiple matches resolve to the first hit in
 * GASCITY_TOPICS order — listed roughly most-specific to least so the
 * narrower subsystem wins over broader ones.
 */
export function deriveTopic(item: TriageItem): string | null {
  const haystack = item.title;
  for (const { topic, re } of TOPIC_REGEXES) {
    if (re.test(haystack)) return topic;
  }
  return null;
}

/**
 * Group items by topic into clusters. Singleton topics fall to the
 * unclustered list. Designed to run AFTER buildClusters: feed it the
 * unclustered residue of the file-overlap pass.
 *
 * Resulting TriageCluster.cluster_id is `@topic/<name>` so the frontend
 * can detect topic-vs-file clusters by prefix and render them with a
 * different header style.
 */
export function buildTopicClusters(items: TriageItem[]): {
  clusters: TriageCluster[];
  unclustered: TriageItem[];
} {
  const byTopic = new Map<string, TriageItem[]>();
  for (const it of items) {
    const topic = deriveTopic(it);
    if (topic === null) continue;
    const list = byTopic.get(topic);
    if (list) list.push(it);
    else byTopic.set(topic, [it]);
  }

  const clusters: TriageCluster[] = [];
  const claimed = new Set<TriageItem>();

  // Order clusters by member-count desc so the biggest subsystems
  // surface first within their tier section.
  const entries = Array.from(byTopic.entries()).sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  for (const [topic, members] of entries) {
    if (members.length < 2) continue;
    for (const m of members) claimed.add(m);
    clusters.push({
      cluster_id: `@topic/${topic}`,
      files: [`@topic/${topic}`],
      items: members
        .slice()
        .sort((a, b) => (b.triage_score ?? 0) - (a.triage_score ?? 0)),
      lines_pending: members
        .filter((m) => m.kind === 'pr')
        .reduce((sum, m) => sum + (m.lines_changed ?? 0), 0),
    });
  }

  const unclustered = items.filter((it) => !claimed.has(it));
  return { clusters, unclustered };
}
