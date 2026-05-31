/**
 * Per-root supervisor query scope sourced from /v0/city/<city>/formulas/feed.
 * This map carries feed authority to the lane builder when root bead metadata
 * lacks gc.scope_kind / gc.scope_ref.
 */
export interface RunFeedScope {
  scopeKind: 'city' | 'rig';
  scopeRef: string;
  rootStoreRef: string;
}

export type RunFeedScopeMap = ReadonlyMap<string, RunFeedScope>;
