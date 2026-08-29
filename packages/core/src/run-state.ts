import type { RunStatus } from "@drobek-bot/contracts";

/**
 * The run state machine as data: for every status, the statuses a run may
 * move to next. Terminal statuses (`completed`, `failed`, `canceled`) have no
 * outgoing transition.
 */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  pending: ["provisioning", "canceled"],
  provisioning: ["running", "failed", "canceled"],
  running: ["awaiting_approval", "completed", "failed", "canceled"],
  awaiting_approval: ["running", "canceled"],
  completed: [],
  failed: [],
  canceled: [],
};

/** Pure: whether a run may move from `from` to `to`. */
export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}
