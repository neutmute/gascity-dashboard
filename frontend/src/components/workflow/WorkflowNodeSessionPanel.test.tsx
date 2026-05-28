import { cleanup, render, screen } from '@testing-library/react';
import type { WorkflowDisplayNode, WorkflowNodeStatus } from 'gas-city-dashboard-shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkflowNodeSessionPanel } from './WorkflowNodeSessionPanel';

afterEach(() => cleanup());

describe('WorkflowNodeSessionPanel', () => {
  it('distinguishes a running node with unresolved session metadata', () => {
    render(<WorkflowNodeSessionPanel node={node('active', 'session_unresolved')} visible />);

    expect(screen.getByText('Session unresolved for the current running node.')).toBeTruthy();
  });

  it('distinguishes work that has not started a session yet', () => {
    render(<WorkflowNodeSessionPanel node={node('ready', 'not_started')} visible />);

    expect(screen.getByText('This node has not started a session yet.')).toBeTruthy();
  });
});

function node(
  status: WorkflowNodeStatus,
  reason: 'not_started' | 'session_unresolved',
): WorkflowDisplayNode {
  return {
    id: 'review',
    semanticNodeId: 'review',
    title: 'Review',
    kind: 'step',
    constructKind: 'step',
    status,
    currentBeadId: 'review',
    scope: { kind: 'workflow' },
    visibleInGraph: true,
    historicalOnly: false,
    iterationSummary: { kind: 'single' },
    attemptSummary: { kind: 'none' },
    visibleExecutionInstanceId: 'review',
    executionInstances: [
      {
        id: 'review',
        semanticNodeId: 'review',
        beadId: 'review',
        iteration: { kind: 'base' },
        attempt: { kind: 'untracked' },
        label: 'base',
        status,
        session: { kind: 'none', reason },
        currentIteration: true,
        historical: false,
      },
    ],
    controlBadges: [],
  };
}
