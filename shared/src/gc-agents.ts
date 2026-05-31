import type { IsoTimestamp } from './gc-client-types.js';
import type { GcList } from './lists.js';

/**
 * One entry from `GET /v0/city/{name}/agents`. Mirrors the supervisor's
 * `AgentResponse` schema narrowed to the fields the Agents list view
 * actually consumes — adding a field means widening both the decoder
 * Zod schema (backend/src/gc-supervisor-decoders.ts) and this type.
 *
 * The agents endpoint is the canonical roster: it surfaces every
 * configured agent regardless of whether a session is currently
 * running, which the previous session-derived path under-counted.
 * `session` is present only when an agent currently has a running
 * supervisor session; orphan agents (configured but not running) carry
 * everything except `session`.
 */
export interface GcAgent {
  /** Stable alias (e.g. 'mayor', 'thriva/devpipeline.architect'). Required. */
  name: string;
  /** Human-readable display name when supervisor sets one. */
  display_name?: string;
  /** Whether the agent is currently available to dispatch (config + runtime). */
  available: boolean;
  /** Whether the underlying process is running. Independent of `state`. */
  running: boolean;
  /** Whether the agent is suspended in city config. */
  suspended: boolean;
  /** gc-level lifecycle state (e.g. 'active', 'asleep', 'closed'). */
  state: string;
  /** Provider (e.g. 'codex', 'claude', 'gemini'). Optional per OpenAPI. */
  provider?: string;
  /** Model identifier (e.g. 'claude-opus-4-7'). */
  model?: string;
  /** Pool / role bucket (e.g. 'orchestration', 'research'). */
  pool?: string;
  /** Rig the agent is scoped to. Empty string for cross-rig agents (mayor). */
  rig?: string;
  /** Coarse activity hint ('idle' | 'thinking' | 'tool_use' | ...). */
  activity?: string;
  /** Raw context-pct as gc reports it. Use effectiveContextPct() for display. */
  context_pct?: number;
  /** gc's reported context-window denominator for the pct above. */
  context_window?: number;
  /** When available===false, the reason string the supervisor surfaces. */
  unavailable_reason?: string;
  /** Embedded SessionInfo when a session is currently bound to this agent. */
  session?: GcAgentSession;
}

/**
 * Subset of supervisor `SessionInfo` carried under `GcAgent.session`. Used to
 * drive the Agents view's peek-modal target + last-activity column when an
 * agent has a running session.
 */
export interface GcAgentSession {
  /** Session id / name on the supervisor (peek-modal target). Required. */
  name: string;
  /** True when a human is currently attached to the tmux session. Required. */
  attached: boolean;
  /** ISO timestamp of the session's most recent activity. */
  last_activity?: IsoTimestamp;
}

export type GcAgentList = GcList<GcAgent>;
