import type { IsoTimestamp } from './gc-client-types.js';
import type { GcCountedList } from './lists.js';

export interface GcEvent {
  seq: number;
  type: string;
  ts: IsoTimestamp;
  /** Required across every TypedEventStreamEnvelope variant in OpenAPI;
   *  present in 200/200 sampled live events. */
  actor: string;
  /** Required across every TypedEventStreamEnvelope variant in OpenAPI;
   *  per-variant payload shape varies (BeadEventPayload, NoPayload, …)
   *  so the surface type stays a generic record. */
  payload: Record<string, unknown>;
  subject?: string;
  message?: string;
}

export type GcEventList = GcCountedList<GcEvent>;
