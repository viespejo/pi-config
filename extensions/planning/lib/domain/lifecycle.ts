/**
 * Plan lifecycle rules and status transitions
 */

import { PlanError } from "../errors";
import type { PlanStatus } from "../types";

const ALLOWED_STATUS_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ["pending", "cancelled", "abandoned"],
  pending: ["draft", "in-progress", "cancelled", "abandoned"],
  "in-progress": ["pending", "completed", "cancelled", "abandoned"],
  completed: [],
  cancelled: ["pending", "in-progress", "abandoned"],
  abandoned: ["pending"],
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
