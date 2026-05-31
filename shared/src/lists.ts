export type Avail<T> =
  | ({ status: 'available' } & T)
  | {
    status: 'unavailable';
    error: string;
  };

export interface GcPartialAware {
  /** True when the supervisor reports the list is incomplete. */
  partial?: boolean;
  /** Human-readable errors from backends that failed during aggregation. */
  partial_errors?: readonly string[];
}

export interface GcList<T> extends GcPartialAware {
  /** Decoder-normalized list items. Degraded `items: null` becomes `[]`. */
  items: T[];
}

export interface GcCountedList<T> extends GcList<T> {
  /** Supervisor's own total count for the requested scope. */
  total: number;
}

export interface GcRequiredPartialList<T> extends Omit<GcList<T>, 'partial'> {
  /** Required on supervisor feeds whose OpenAPI declares `partial: boolean`. */
  partial: boolean;
}
