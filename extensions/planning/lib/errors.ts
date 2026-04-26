/**
 * Domain errors for planning extension
 */

export type PlanErrorCode =
  | "PLAN_NOT_FOUND"
  | "INVALID_STATUS_TRANSITION"
  | "DEPENDENCIES_NOT_SATISFIED"
  | "INVALID_FRONTMATTER"
  | "PLAN_ASSIGNED_TO_OTHER_SESSION";

export class PlanError extends Error {
  constructor(
    public readonly code: PlanErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PlanError";
  }
}
