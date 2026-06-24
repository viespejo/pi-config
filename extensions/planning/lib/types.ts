/**
 * Types for planning extension
 */

// TODO(final-status-migration): remove legacy "cancelled" and "abandoned" statuses.
export type PlanStatus =
  | "draft"
  | "pending"
  | "in-progress"
  | "paused"
  | "completed"
  | "cancelled"
  | "abandoned";

export interface PlanInfo {
  filename: string;
  path: string;
  slug: string;
  date: string;
  title: string;
  directory: string;
  project?: string;
  phase?: string;
  status: PlanStatus;
  dependencies: string[];
  dependents: string[];
}

export interface DependencyNode {
  plan: PlanInfo;
  children: DependencyNode[]; // plans that depend on this
}

export interface DependencyCheckResult {
  resolved: PlanInfo[];
  unresolved: string[]; // slugs not found or not completed
}

export type ExecutionRecordType = "terminal" | "follow_up";

export type ExecutionDecision = "agent_applied" | "skipped";

export type ExecutionReviewStatus = "accepted" | "amended_manually";

export interface PlanExecutionRecordV1 {
  timestamp: string;
  taskId: string;
  recordType?: ExecutionRecordType;
  decision?: ExecutionDecision;
  sessionId?: string;
  reviewStatus?: ExecutionReviewStatus;
  note?: string;
}
