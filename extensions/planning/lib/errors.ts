/**
 * Domain errors for planning extension
 */

export type PlanErrorCode =
  | "PLAN_NOT_FOUND"
  | "INVALID_STATUS_TRANSITION"
  | "DEPENDENCIES_NOT_SATISFIED"
  | "INVALID_FRONTMATTER"
  | "INVALID_EXECUTION_LOG";

export class PlanError extends Error {
  public readonly code: PlanErrorCode;

  public readonly details?: Record<string, unknown>;

  constructor(
    code: PlanErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PlanError";
    this.code = code;
    this.details = details;
  }
}
