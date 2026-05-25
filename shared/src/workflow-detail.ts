export type WorkflowScopeKind = 'city' | 'rig';

export type WorkflowNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'active'
  | 'done'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'skipped';

export type WorkflowConstructKind =
  | 'workflow-root'
  | 'step'
  | 'retry'
  | 'check-loop'
  | 'scope'
  | 'condition'
  | 'fanout'
  | 'expansion'
  | 'scope-check'
  | 'workflow-finalize'
  | 'spec'
  | 'control'
  | 'unknown';

export interface WorkflowSessionLink {
  sessionId: string;
  sessionName: string;
  assignee: string;
  rigId?: string;
}

export interface WorkflowExecutionInstance {
  id: string;
  semanticNodeId: string;
  beadId?: string;
  iteration?: number;
  attempt?: number;
  label?: string;
  status?: WorkflowNodeStatus;
  sessionLink?: WorkflowSessionLink | null;
  currentIteration?: boolean;
  historical?: boolean;
  streamable?: boolean;
}

export interface WorkflowControlBadge {
  id: string;
  label: string;
  status: WorkflowNodeStatus;
}

export interface WorkflowDisplayNode {
  id: string;
  semanticNodeId: string;
  title: string;
  kind: string;
  constructKind: WorkflowConstructKind;
  status: WorkflowNodeStatus;
  currentBeadId?: string;
  scopeRef?: string;
  loopControlNodeId?: string;
  visibleIteration?: number;
  iterationCount?: number;
  hasHistoricalIterations?: boolean;
  attemptBadge?: string;
  attemptCount?: number;
  activeAttempt?: number;
  visibleExecutionInstanceId?: string;
  executionInstances: WorkflowExecutionInstance[];
  controlBadges?: WorkflowControlBadge[];
}

export interface WorkflowDisplayEdge {
  from: string;
  to: string;
  kind?: string;
}

export interface WorkflowDisplayLane {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface WorkflowRunDetail {
  workflowId: string;
  rootBeadId: string;
  rootStoreRef: string;
  resolvedRootStore: string;
  scopeKind: WorkflowScopeKind;
  scopeRef: string;
  title: string;
  formula: string | null;
  executionPath: string | null;
  snapshotVersion: number;
  snapshotEventSeq?: number | null;
  partial: boolean;
  nodes: WorkflowDisplayNode[];
  edges: WorkflowDisplayEdge[];
  lanes: WorkflowDisplayLane[];
}

export type WorkflowDiffKind = 'ok' | 'not_git' | 'path_unknown' | 'error';

export type WorkflowChangedFileKind =
  | 'code'
  | 'test'
  | 'docs'
  | 'config'
  | 'other';

export interface WorkflowChangedFile {
  path: string;
  status: string;
  kind: WorkflowChangedFileKind;
}

export interface WorkflowDiffResponse {
  kind: WorkflowDiffKind;
  rootPath: string | null;
  status: string[];
  changedFiles: WorkflowChangedFile[];
  unstagedDiff: string;
  stagedDiff: string;
  truncated: boolean;
  error?: string;
}
