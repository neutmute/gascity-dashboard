import { useEffect, useState } from 'react';
import type {
  WorkflowDiffResponse,
  WorkflowRunDetail,
  WorkflowScopeKind,
} from 'gas-city-dashboard-shared';
import { api } from '../api/client';

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
): WorkflowRunDetailState {
  const [state, setState] = useState<WorkflowRunDetailState>({
    detail: null,
    diff: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!workflowId) {
      setState({ detail: null, diff: null, loading: false, error: 'Missing workflow id.' });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));
    const params = { scopeKind, scopeRef };
    Promise.all([
      api.workflowRun(workflowId, params),
      api.workflowDiff(workflowId, params).catch((err: unknown) => ({
        kind: 'error',
        rootPath: null,
        status: [],
        changedFiles: [],
        unstagedDiff: '',
        stagedDiff: '',
        truncated: false,
        error: err instanceof Error ? err.message : 'Failed to load diff.',
      } satisfies WorkflowDiffResponse)),
    ]).then(
      ([detail, diff]) => {
        if (!cancelled) setState({ detail, diff, loading: false, error: null });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({
            detail: null,
            diff: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load workflow.',
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workflowId, scopeKind, scopeRef]);

  return state;
}
