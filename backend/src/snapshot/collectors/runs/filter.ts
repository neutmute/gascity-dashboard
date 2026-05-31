import type { GcBead } from 'gas-city-dashboard-shared';

import { stringValue } from '../phaseMapping.js';

const ENGINEERING_TYPES = new Set([
  'feature',
  'bug',
  'task',
  'docs',
  'molecule',
]);

/**
 * Co-located filter for the runs view. Differs from routes/beads.ts by
 * admitting molecule and gc.kind='run' beads so graph.v2 root groups have
 * enough context to build lanes. Still excludes gc:* labels.
 */
export function runBeadFilter(bead: GcBead): boolean {
  if (Array.isArray(bead.labels) && bead.labels.some((l) => l.startsWith('gc:'))) {
    return false;
  }
  if (ENGINEERING_TYPES.has(bead.issue_type)) {
    return true;
  }
  if (stringValue(bead.metadata?.['gc.kind']) === 'run') {
    return true;
  }
  return false;
}
