import type { GcList } from './lists.js';

/**
 * Per-rig shape returned by `GET /v0/city/{name}/rigs`. The supervisor's
 * RigResponse carries more fields (agent_count, running_count, git status,
 * suspended, last_activity, default_branch, prefix); only name + path are
 * exposed here because that's all the snapshot collector's CityRig
 * downstream contract needs. Other fields are intentionally dropped at
 * the decoder edge — adding one means widening both the decoder Zod
 * schema and the consumer (CityRig in snapshot/types.ts).
 */
export interface GcRig {
  name: string;
  path: string;
}

export type GcRigList = GcList<GcRig>;
