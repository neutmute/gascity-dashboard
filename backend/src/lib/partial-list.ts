import { sanitizeForLog } from '../logging.js';

export interface PartialAwareList {
  partial?: boolean;
  partial_errors?: readonly string[];
}

export function isPartialList(list: PartialAwareList): boolean {
  return list.partial === true || partialReasonsFromList(list).length > 0;
}

export function partialReasonsFromList(list: PartialAwareList): readonly string[] {
  return list.partial_errors ?? [];
}

/**
 * Format supervisor-reported `partial_errors` for an operator log line.
 * Each entry is newline-sanitized before joining so a hostile or
 * misbehaving supervisor cannot inject forged log lines. Returns
 * `'no detail'` when the array is absent or empty.
 */
export function formatPartialErrors(errors: readonly string[] | undefined): string {
  if (!errors || errors.length === 0) return 'no detail';
  return errors.map(sanitizeForLog).join(', ');
}
