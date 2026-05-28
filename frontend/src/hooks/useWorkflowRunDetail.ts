import type {
  WorkflowDiffResponse,
  WorkflowRunDetail,
  WorkflowScopeKind,
} from 'gas-city-dashboard-shared';
import { errorMessage } from 'gas-city-dashboard-shared';
import { api } from '../api/client';
import { reportClientError } from '../lib/clientErrorReporting';
import { useCachedData } from './useCachedData';

interface WorkflowRunDetailState {
  detail: WorkflowRunDetail | null;
  diff: WorkflowDiffResponse | null;
  loading: boolean;
  error: string | null;
}

export function useWorkflowRunDetail(
  workflowId: string | undefined,
  scopeKind?: WorkflowScopeKind,
  scopeRef?: string,
): WorkflowRunDetailState & { refresh: () => Promise<void> } {
  const key = workflowRunDetailCacheKey(workflowId, scopeKind, scopeRef);
  const { data, loading, error, refresh } = useCachedData(
    key,
    () => loadWorkflowRunDetail(workflowId, scopeKind, scopeRef),
    {
      onError: (err) => {
        if (workflowId !== undefined) reportWorkflowDetailError('load detail', workflowId, err);
      },
    },
  );

  return {
    detail: workflowId ? data?.detail ?? null : null,
    diff: workflowId ? data?.diff ?? null : null,
    loading: workflowId ? loading : false,
    error: workflowId ? error : null,
    refresh: workflowId ? refresh : noopRefresh,
  };
}

async function loadWorkflowRunDetail(
  workflowId: string | undefined,
  scopeKind?: WorkflowScopeKind,
  scopeRef?: string,
): Promise<Pick<WorkflowRunDetailState, 'detail' | 'diff'>> {
  if (!workflowId) return { detail: null, diff: null };
  const params: { scopeKind?: WorkflowScopeKind; scopeRef?: string } = {};
  if (scopeKind !== undefined) params.scopeKind = scopeKind;
  if (scopeRef !== undefined) params.scopeRef = scopeRef;
  const [detail, diff] = await Promise.all([
    api.workflowRun(workflowId, params),
    api.workflowDiff(workflowId, params).catch((err: unknown) => {
      reportWorkflowDetailError('load diff', workflowId, err);
      return {
        kind: 'error',
        rootPath: { kind: 'unavailable', reason: 'error' },
        status: [],
        changedFiles: [],
        unstagedDiff: '',
        stagedDiff: '',
        truncated: false,
        error: errorMessage(err) || 'Failed to load diff.',
      } satisfies WorkflowDiffResponse;
    }),
  ]);
  return { detail, diff };
}

async function noopRefresh(): Promise<void> {}

function reportWorkflowDetailError(
  operation: string,
  workflowId: string,
  err: unknown,
): void {
  void reportClientError({
    component: 'workflow-run-detail',
    operation,
    message: `${workflowId}: ${errorMessage(err)}`,
  });
}

function workflowRunDetailCacheKey(
  workflowId: string | undefined,
  scopeKind?: WorkflowScopeKind,
  scopeRef?: string,
): string {
  const parts = [
    'workflow-run',
    workflowId ?? 'missing',
    scopeKind ?? 'default',
    scopeRef ?? 'default',
  ];
  return parts.join(':');
}
