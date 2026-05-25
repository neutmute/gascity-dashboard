import type { GcBead } from 'gas-city-dashboard-shared';

export interface RawWorkflowDep {
  issue_id?: string;
  depends_on_id?: string;
  from?: string;
  to?: string;
  kind?: string;
  type?: string;
}

export interface RawWorkflowBead extends Partial<GcBead> {
  kind?: string;
  step_ref?: string;
  logical_bead_id?: string;
  scope_ref?: string;
  attempt?: number | string;
  metadata?: Record<string, unknown>;
}

export interface RawWorkflowSnapshot {
  workflow_id?: string;
  workflowId?: string;
  root_bead_id?: string;
  rootBeadId?: string;
  root_store_ref?: string;
  rootStoreRef?: string;
  resolved_root_store?: string;
  resolvedRootStore?: string;
  scope_kind?: string;
  scopeKind?: string;
  scope_ref?: string;
  scopeRef?: string;
  snapshot_version?: number;
  snapshotVersion?: number;
  snapshot_event_seq?: number | null;
  snapshotEventSeq?: number | null;
  contract?: string;
  formula?: string;
  cwd?: string;
  work_dir?: string;
  rig_root?: string;
  root?: RawWorkflowBead;
  beads?: RawWorkflowBead[];
  deps?: RawWorkflowDep[];
}
