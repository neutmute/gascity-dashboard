import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { WorkflowDisplayNode, WorkflowDiffResponse } from 'gas-city-dashboard-shared';
import { WorkflowNodeEvidencePanel } from './WorkflowNodeEvidencePanel';

interface WorkflowRunTabsProps {
  diff: WorkflowDiffResponse | null;
  selectedNode: WorkflowDisplayNode | null;
}

export function WorkflowRunTabs({ diff, selectedNode }: WorkflowRunTabsProps) {
  const [tab, setTab] = useState<'diff' | 'session'>('diff');

  useEffect(() => {
    if (selectedNode) setTab('session');
  }, [selectedNode]);

  return (
    <section aria-label="Workflow evidence">
      <div className="flex gap-2 border-b border-rule">
        <TabButton active={tab === 'diff'} onClick={() => setTab('diff')}>
          Diff
        </TabButton>
        <TabButton active={tab === 'session'} onClick={() => setTab('session')}>
          Session
        </TabButton>
      </div>
      <div className="pt-5">
        <WorkflowNodeEvidencePanel tab={tab} diff={diff} selectedNode={selectedNode} />
      </div>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`focus-mark text-label uppercase tracking-wider px-0 py-2 border-b-2 ${
        active
          ? 'border-accent text-fg'
          : 'border-transparent text-fg-muted'
      }`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
