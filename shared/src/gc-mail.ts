import type { IsoTimestamp } from './gc-client-types.js';
import type { GcCountedList } from './lists.js';

/**
 * Body for `POST /v0/city/{city}/mail` (gascity-dashboard-mq2; replaces the
 * `gc mail send` CLI subprocess). Mirrors the supervisor's `MailSendInputBody`.
 * The server pins `from: 'human'` (gc's canonical operator identity); the
 * browser-facing shape (`MailComposeRequest`) has no `from` slot, so there is
 * no path to send-as-someone-else. `to`/`subject` are required upstream.
 */
export interface MailSendInput {
  to: string;
  subject: string;
  body: string;
  from: string;
  rig?: string;
}

/**
 * Response from `POST /v0/city/{city}/mail` (the supervisor's `Message`
 * schema; returns 201). Only `id` is consumed by the dashboard (surfaced as
 * `message_id` on the browser-facing `MailSendResult`); the rest is typed
 * optional so a schema addition upstream doesn't break parsing.
 */
export interface MailSendResponse {
  id: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  created_at?: IsoTimestamp;
  read?: boolean;
  thread_id?: string;
  rig?: string;
  /** Optional supervisor-assigned priority (OpenAPI Message.priority). */
  priority?: number;
  /** Optional CC list (OpenAPI Message.cc). */
  cc?: string[] | null;
  /** Optional reply-to header (OpenAPI Message.reply_to). */
  reply_to?: string;
}

export interface GcMailItem {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  created_at: IsoTimestamp;
  read: boolean;
  thread_id?: string;
  rig?: string;
  /** Optional supervisor-assigned priority (OpenAPI Message.priority). */
  priority?: number;
  /** Optional CC list (OpenAPI Message.cc). */
  cc?: string[] | null;
  /** Optional reply-to header (OpenAPI Message.reply_to). */
  reply_to?: string;
}

export type GcMailList = GcCountedList<GcMailItem>;

/** Frontend "viewing as" context state. Default identity is the operator ('stephanie'). */
export interface ViewingAs {
  alias: string;
  /** True iff alias === the operator alias (the sole identity that can send). */
  isOperator: boolean;
}

/**
 * Compose payload — the SINGLE wire shape the mail-send router accepts.
 * The server hardcodes the operator identity. The frontend cannot trick
 * the server into sending as someone else because there's no slot in the
 * shape.
 */
export interface MailComposeRequest {
  to: string;
  subject: string;
  body: string;
}

export interface MailSendResult {
  ok: true;
  message_id?: string;
}
