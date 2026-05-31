import type {
  GcSession,
  MaintainerTriage,
  SlingInput,
  SlingResponse,
} from 'gas-city-dashboard-shared';
import { recordAudit } from '../../../audit.js';
import { GcClient } from '../../../gc-client.js';
import { LOG_COMPONENT, errorMessage, logWarn } from '../../../logging.js';
import { resolveTargetToSession } from './resolve-target.js';
import { slungKey, writeSlungEntry } from './slung-state.js';
import { notifyRefresh as notifyMaintainerRefresh } from './sse.js';
import type { DecodedSlingRequest } from './sling-request.js';

export interface DispatchMaintainerSlingDeps {
  readonly repo: string;
  readonly slungStatePath: string;
  readonly sling: (input: SlingInput) => Promise<SlingResponse>;
  readonly listSessions?: () => Promise<readonly GcSession[]>;
  readonly notifyRefresh?: (payload: Pick<MaintainerTriage, 'computed_at' | 'repo'>) => void;
}

export interface DispatchMaintainerSlingResult {
  readonly beadId: string | null;
}

export async function dispatchMaintainerSling(
  body: DecodedSlingRequest,
  deps: DispatchMaintainerSlingDeps,
): Promise<DispatchMaintainerSlingResult> {
  const startedAt = Date.now();
  try {
    const result = await deps.sling({ target: body.target, bead: body.beadText });
    // root_bead_id is the routed bead the supervisor created — the JSON
    // replacement for the old `^Slung <id>` stdout parse. `bead` is a
    // fallback if a future supervisor omits root_bead_id; null when
    // neither is present (slung-state tolerates a null bead_id).
    const beadId = result.root_bead_id ?? result.bead ?? null;
    await recordAudit({
      type: 'dashboard.sling',
      endpoint: 'POST /api/maintainer/sling',
      parsed_args: auditArgs(body),
      duration_ms: Date.now() - startedAt,
    });

    // Resolve the target role (e.g. 'chief-of-staff') to a concrete
    // session_name before persisting so the frontend renders a real
    // /agents/<session_name> link instead of a role-label 404.
    const resolvedSessionName = await resolveTargetSafely(body.target, deps.listSessions);
    try {
      await writeSlungEntry(deps.slungStatePath, slungKey(body.kind, body.number), {
        slung_at: new Date().toISOString(),
        target: body.target,
        bead_id: beadId,
        resolved_session_name: resolvedSessionName,
      });
    } catch (slungErr) {
      // Slung-state write failure is non-fatal: the sling itself
      // succeeded, the audit row is in place, the operator just won't
      // see the One Mark move until the next refresh.
      logWarn(
        LOG_COMPONENT.maintainer,
        `slung-state write failed (sling succeeded): ${errorMessage(slungErr)}`,
      );
    }

    const notify = deps.notifyRefresh ?? notifyMaintainerRefresh;
    notify({ computed_at: null, repo: deps.repo });
    return { beadId };
  } catch (err) {
    // Thrown errors must also leave an audit row. Timeouts in particular
    // are operationally significant; otherwise the most interesting
    // failure mode leaves no forensic record in events.jsonl.
    const isTimeout = GcClient.isTimeoutError(err);
    await recordAudit({
      type: 'dashboard.sling',
      endpoint: 'POST /api/maintainer/sling',
      parsed_args: {
        ...auditArgs(body),
        error_kind: isTimeout ? 'timeout' : 'upstream',
      },
    });
    throw err;
  }
}

function auditArgs(body: DecodedSlingRequest): Record<string, string> {
  return {
    kind: body.kind,
    number: String(body.number),
    intent: body.intent,
    target: body.target,
    text_len: String(body.beadText.length),
  };
}

/**
 * Resolves the configured `gc sling` target role to a concrete session
 * name. Wraps both missing DI and supervisor failure: both cases return
 * null so the slung-state entry persists, while the frontend can surface
 * an inline "no session for role" state instead of linking to a 404.
 */
async function resolveTargetSafely(
  target: string,
  listSessions: (() => Promise<readonly GcSession[]>) | undefined,
): Promise<string | null> {
  if (listSessions === undefined) return null;
  try {
    const sessions = await listSessions();
    return resolveTargetToSession(target, sessions);
  } catch (err) {
    logWarn(
      LOG_COMPONENT.maintainer,
      `sling target resolution failed (sling succeeded, link will surface 'no session for role' error): ${errorMessage(err)}`,
    );
    return null;
  }
}
