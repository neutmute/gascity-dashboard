import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useCity } from './useCity.ts';
import { useMouseWheel } from './useMouseWheel.ts';
import { AgentRow, DetailPane, HealthPane } from './panes.tsx';
import { closePeek, insideTmux, openPeek, paneExists, replacePeek } from './peek.ts';
import {
  beadsForRig,
  categorize,
  contextPressure,
  groupByRig,
  lanesForRig,
  neverActiveByRig,
  systemHealth,
  type AgentView,
  type Category,
  type RigGroup,
} from './derive.ts';

interface AppProps {
  readonly baseUrl: string;
  readonly city: string;
}

type Row =
  | { readonly kind: 'heading'; readonly group: RigGroup }
  | {
      readonly kind: 'agent';
      readonly view: AgentView;
      readonly agentIndex: number;
      readonly group: RigGroup;
    };

type ViewMode = 'list' | 'detail' | 'health';

function useTerminalRows(): number {
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows ?? 24);
  useEffect(() => {
    const onResize = (): void => setRows(stdout.rows ?? 24);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return rows;
}

export function App({ baseUrl, city }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { sessions, snapshot, beads, error, conn } = useCity(baseUrl, city);
  const rows = useTerminalRows();

  const [view, setView] = useState<ViewMode>('list');
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  // A single reused peek pane: its tmux id, and which agent it's showing.
  const [peekPaneId, setPeekPaneId] = useState<string | null>(null);
  const [peekAgentId, setPeekAgentId] = useState<string | null>(null);
  const now = Date.now();

  // Grouped by rig; within a rig, active before idle (groupByRig owns the sort).
  const { agents, renderRows } = useMemo(() => {
    const groups = groupByRig(sessions);
    const agentList: AgentView[] = [];
    const rowList: Row[] = [];
    for (const g of groups) {
      rowList.push({ kind: 'heading', group: g });
      for (const view of g.agents) {
        rowList.push({ kind: 'agent', view, agentIndex: agentList.length, group: g });
        agentList.push(view);
      }
    }
    return { agents: agentList, renderRows: rowList };
  }, [sessions]);

  const cursorIndex = Math.max(
    0,
    agents.findIndex((a) => a.session.id === cursorId),
  );
  const selected: AgentView | undefined = agents[cursorIndex];

  // Keep cursor pointed at a real agent as the list churns.
  useEffect(() => {
    if (agents.length === 0) return;
    const exists = cursorId !== null && agents.some((a) => a.session.id === cursorId);
    if (!exists) setCursorId(agents[0]?.session.id ?? null);
  }, [agents, cursorId]);

  // Refs so the wheel callback stays stable (re-subscribing would re-emit the
  // mouse-enable escape sequence on every render).
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const cursorIndexRef = useRef(cursorIndex);
  cursorIndexRef.current = cursorIndex;

  const moveCursor = useCallback((delta: number) => {
    const list = agentsRef.current;
    if (list.length === 0) return;
    const next = Math.min(Math.max(cursorIndexRef.current + delta, 0), list.length - 1);
    setCursorId(list[next]?.session.id ?? null);
  }, []);

  useMouseWheel(useCallback((dir: -1 | 1) => moveCursor(dir * 3), [moveCursor]));

  // Tear down our peek pane on the way out so quitting doesn't leave an orphan
  // shell pane behind in the tmux session.
  const quit = (): void => {
    if (peekPaneId !== null && paneExists(peekPaneId)) closePeek(peekPaneId);
    exit();
  };

  // Every render row is exactly ONE line (no per-heading blank line), so the
  // window's row count equals its line count. chrome = header + sticky line +
  // footer (+ error line). Keeping this exact is what prevents the content
  // from overflowing the screen and scrolling the top off.
  const chrome = error ? 4 : 3;
  const viewport = Math.max(3, rows - chrome);
  const maxTop = Math.max(0, renderRows.length - viewport);

  // Cursor's row index (heading rows shift it), used to keep it on screen.
  const cursorRowIndex = renderRows.findIndex(
    (r) => r.kind === 'agent' && r.agentIndex === cursorIndex,
  );
  useEffect(() => {
    if (cursorRowIndex < 0) return;
    setScrollTop((top) => {
      if (cursorRowIndex < top) return cursorRowIndex;
      if (cursorRowIndex >= top + viewport) return cursorRowIndex - viewport + 1;
      return Math.min(top, maxTop);
    });
  }, [cursorRowIndex, viewport, maxTop]);

  const effectiveTop = Math.min(scrollTop, maxTop);
  const visible = renderRows.slice(effectiveTop, effectiveTop + viewport);
  const above = effectiveTop;
  const below = Math.max(0, renderRows.length - (effectiveTop + viewport));
  // When the window opens mid-rig (its heading scrolled off), show that rig as
  // a dim sticky label so the top rows are never orphaned/untitled.
  const firstVisible = visible[0];
  const stickyGroup: RigGroup | null =
    firstVisible && firstVisible.kind === 'agent' ? firstVisible.group : null;

  useInput(
    (input, key) => {
      if (input === 'q') {
        quit();
        return;
      }
      if (key.escape) {
        if (view === 'list') quit();
        else setView('list');
        return;
      }
      if (input === 'h') {
        setView((v) => (v === 'health' ? 'list' : 'health'));
        return;
      }
      if (key.return) {
        // One reused peek pane: open it, retarget it to the selected agent, or
        // (if it's already showing this agent) toggle it closed.
        if (!selected) return;
        if (!insideTmux()) {
          setStatus('peek: not inside tmux — use `npm --workspace tui run start:tmux`');
          return;
        }
        const root = snapshot?.config.cityRoot ?? null;
        const live = peekPaneId !== null && paneExists(peekPaneId);
        if (live && peekAgentId === selected.session.id) {
          closePeek(peekPaneId);
          setPeekPaneId(null);
          setPeekAgentId(null);
          setStatus('peek closed');
        } else if (live) {
          const r = replacePeek(peekPaneId, selected.session.id, root);
          if (r.ok) setPeekAgentId(selected.session.id);
          setStatus(r.ok ? `peeking ${selected.agent} →` : `peek: ${r.error}`);
        } else {
          const r = openPeek(selected.session.id, root);
          if (r.ok) {
            setPeekPaneId(r.paneId ?? null);
            setPeekAgentId(selected.session.id);
          }
          setStatus(r.ok ? `peeking ${selected.agent} →` : `peek: ${r.error}`);
        }
        return;
      }
      if (input === 'x') {
        // Close the peek pane.
        if (peekPaneId !== null && paneExists(peekPaneId)) {
          closePeek(peekPaneId);
          setStatus('peek closed');
        }
        setPeekPaneId(null);
        setPeekAgentId(null);
        return;
      }
      if (input === 'p') {
        setView((v) => (v === 'detail' ? 'list' : 'detail'));
        return;
      }
      if (key.downArrow || input === 'j') moveCursor(1);
      else if (key.upArrow || input === 'k') moveCursor(-1);
      else if (key.pageDown) moveCursor(viewport);
      else if (key.pageUp) moveCursor(-viewport);
      else if (input === 'g') moveCursor(-agents.length);
      else if (input === 'G') moveCursor(agents.length);
    },
    { isActive: Boolean(process.stdin.isTTY) },
  );

  const counts: Record<Category, number> = { failed: 0, active: 0, idle: 0 };
  for (const s of sessions) counts[categorize(s)] += 1;
  const health = systemHealth(snapshot);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text>
          <Text bold>{city}</Text>
          <Text dimColor>  </Text>
          {counts.failed > 0 ? (
            <Text>
              <Text color="red">{counts.failed} failed</Text>
              <Text dimColor> · </Text>
            </Text>
          ) : null}
          <Text>{counts.active} active</Text>
          <Text dimColor> · {counts.idle} idle · {sessions.length} agents</Text>
          {health.activeRuns !== null ? (
            <Text dimColor> · {health.activeRuns} runs</Text>
          ) : null}
        </Text>
        <Text dimColor>{conn === 'open' ? 'live' : conn === 'closed' ? 'reconnecting…' : conn}</Text>
      </Box>

      {error ? (
        <Box>
          <Text color="red">! {error}</Text>
        </Box>
      ) : null}

      {view === 'health' ? (
        <Box marginTop={1}>
          <HealthPane
            health={health}
            idle={neverActiveByRig(sessions)}
            pressure={contextPressure(sessions)}
            now={now}
          />
        </Box>
      ) : view === 'detail' && selected ? (
        <Box marginTop={1}>
          <DetailPane
            view={selected}
            beads={beadsForRig(beads, selected.rig)}
            lanes={lanesForRig(health.lanes, selected.rig)}
            now={now}
          />
        </Box>
      ) : (
        <>
          {/* Sticky rig context (or a spacer) so the top of the list keeps a
              title even when its heading has scrolled above the window. */}
          {stickyGroup ? (
            <Box>
              <Text dimColor>{stickyGroup.rig}</Text>
              <Text dimColor>
                {'  '}
                {stickyGroup.active} active · {stickyGroup.idle} idle ↑
              </Text>
            </Box>
          ) : (
            <Box>
              <Text> </Text>
            </Box>
          )}
          <Box flexDirection="column">
            {renderRows.length === 0 && !error ? (
              <Text dimColor>no sessions</Text>
            ) : (
              visible.map((row) =>
                row.kind === 'heading' ? (
                  <Box key={`h:${row.group.rig}`}>
                    {row.group.failed > 0 ? (
                      <Text bold color="red">{row.group.rig}</Text>
                    ) : (
                      <Text bold>{row.group.rig}</Text>
                    )}
                    <Text dimColor>
                      {'  '}
                      {row.group.failed > 0 ? `${row.group.failed} failed · ` : ''}
                      {row.group.active} active · {row.group.idle} idle
                    </Text>
                  </Box>
                ) : (
                  <AgentRow
                    key={row.view.session.id}
                    view={row.view}
                    selected={row.agentIndex === cursorIndex}
                    dim={row.view.category === 'idle'}
                    now={now}
                  />
                ),
              )
            )}
          </Box>
          <Box justifyContent="space-between">
            {status ? (
              <Text dimColor>{status}</Text>
            ) : (
              <Text dimColor>
                {above > 0 ? `↑ ${above} ` : '   '}
                {below > 0 ? `↓ ${below}` : ''}
              </Text>
            )}
            <Text dimColor>↑↓/wheel · enter peek · x close · p detail · h health · q quit</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
