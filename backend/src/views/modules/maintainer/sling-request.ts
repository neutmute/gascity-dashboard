import { AGENT_ALIAS_RE } from '../../../exec.js';

const GH_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(issues|pull)\/\d+$/;
const MAX_URL_LEN = 2_048;

export type SlingIntent = 'review' | 'draft' | 'triage';
export type SlingKind = 'pr' | 'issue';

export interface SlingTargetDefaults {
  readonly slingTarget: string;
  readonly triageTarget?: string;
}

export interface DecodedSlingRequest {
  readonly kind: SlingKind;
  readonly number: number;
  readonly html_url: string;
  readonly intent: SlingIntent;
  readonly target: string;
  readonly beadText: string;
}

export type DecodeSlingRequestResult =
  | { readonly status: 'ok'; readonly request: DecodedSlingRequest }
  | { readonly status: 'error'; readonly message: string };

export function decodeSlingRequest(
  value: unknown,
  defaults: SlingTargetDefaults,
): DecodeSlingRequestResult {
  if (!isRecord(value)) return invalid('request body must be an object');
  const body = value;
  if (!isSlingKind(body.kind)) return invalid('invalid kind (pr|issue)');
  if (!isSlingIntent(body.intent)) return invalid('invalid intent (review|draft|triage)');
  if (!isValidIssueNumber(body.number)) return invalid('invalid number');
  if (typeof body.html_url !== 'string' || body.html_url.length > MAX_URL_LEN) {
    return invalid('invalid html_url');
  }
  const urlMatch = GH_URL_RE.exec(body.html_url);
  if (urlMatch === null) return invalid('invalid html_url');
  const urlPath = urlMatch[1];
  const expected = body.kind === 'pr' ? 'pull' : 'issues';
  if (urlPath !== expected) return invalid('kind/html_url mismatch');

  let target =
    body.intent === 'triage' && defaults.triageTarget !== undefined
      ? defaults.triageTarget
      : defaults.slingTarget;
  if (body.target !== undefined) {
    if (typeof body.target !== 'string' || !AGENT_ALIAS_RE.test(body.target)) {
      return invalid('invalid target alias');
    }
    target = body.target;
  }

  return {
    status: 'ok',
    request: {
      kind: body.kind,
      number: body.number,
      html_url: body.html_url,
      intent: body.intent,
      target,
      beadText: composeBeadText(body.intent, body.html_url),
    },
  };
}

function invalid(message: string): DecodeSlingRequestResult {
  return { status: 'error', message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSlingIntent(v: unknown): v is SlingIntent {
  return v === 'review' || v === 'draft' || v === 'triage';
}

function isSlingKind(v: unknown): v is SlingKind {
  return v === 'pr' || v === 'issue';
}

function isValidIssueNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 2_147_483_647
  );
}

function composeBeadText(intent: SlingIntent, htmlUrl: string): string {
  switch (intent) {
    case 'review':
      return `Please review PR ${htmlUrl}`;
    case 'draft':
      return `Please draft a PR addressing ${htmlUrl}`;
    case 'triage':
      return `Please triage ${htmlUrl}`;
  }
}
