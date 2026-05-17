/**
 * Plan lifecycle rules and status transitions
 */

import { PlanError } from "../errors";
import type { PlanStatus } from "../types";

// TODO(final-status-migration): remove legacy cancelled/abandoned transitions.
const ALLOWED_STATUS_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["pending", "paused", "cancelled", "abandoned"],
  pending: ["draft", "in-progress", "paused", "cancelled", "abandoned"],
  "in-progress": ["pending", "paused", "completed", "cancelled", "abandoned"],
  paused: ["pending", "in-progress", "completed"],
  completed: [],
  cancelled: ["pending", "in-progress", "paused", "abandoned"],
  abandoned: ["pending", "paused"],
};

export function canTransitionStatus(from: PlanStatus, to: PlanStatus): boolean {
  if (from === to) return true;
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

export function assertValidStatusTransition(
  from: PlanStatus,
  to: PlanStatus,
): void {
  if (!canTransitionStatus(from, to)) {
    throw new PlanError(
      "INVALID_STATUS_TRANSITION",
      `Invalid status transition: ${from} -> ${to}`,
      { from, to },
    );
  }
}
