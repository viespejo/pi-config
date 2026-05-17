import * as path from "node:path";

import { PlanError } from "./errors.ts";
import type {
  ExecutionDecision,
  ExecutionReviewStatus,
  PlanExecutionRecordV1,
} from "./types.ts";

const VALID_EXECUTION_DECISIONS: ReadonlySet<ExecutionDecision> = new Set([
  "agent_applied",
  "skipped",
]);

const VALID_REVIEW_STATUSES: ReadonlySet<ExecutionReviewStatus> = new Set([
  "accepted",
  "amended_manually",
]);

export interface ParsedExecutionRecord {
  line: number;
  taskIndex: number;
  record: PlanExecutionRecordV1;
}

export function buildExecutionLogFilename(slug: string): string {
  return `${slug}.execution.jsonl`;
}

export function buildExecutionLogPath(plansDir: string, slug: string): string {
  return path.join(plansDir, buildExecutionLogFilename(slug));
}

export function parseExecutionLogJsonl(
  content: string,
  orderedTaskIds: string[],
): ParsedExecutionRecord[] {
  const indexByTaskId = new Map(orderedTaskIds.map((id, index) => [id, index]));
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsed: ParsedExecutionRecord[] = [];
  let lastTaskIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i];
    if (!line) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new PlanError(
        "INVALID_EXECUTION_LOG",
        `Execution log line ${lineNumber} is not valid JSON`,
      );
    }

    if (!value || typeof value !== "object") {
      throw new PlanError(
        "INVALID_EXECUTION_LOG",
        `Execution log line ${lineNumber} must be a JSON object`,
      );
    }

    const record = value as Partial<PlanExecutionRecordV1>;
    const timestamp = record.timestamp?.trim();
    const taskId = record.taskId?.trim();
    const decision = record.decision;

    if (!timestamp) {
      throw new PlanError(
        "INVALID_EXECUTION_LOG",
        `Execution log line ${lineNumber} is missing required field: timestamp`,
      );
    }

    if (!taskId) {
      throw new PlanError(
        "INVALID_EXECUTION_LOG",
        `Execution log line ${lineNumber} is missing required field: taskId`,
      );
    }

    if (!decision || !VALID_EXECUTION_DECISIONS.has(decision)) {
      throw new PlanError(
        "INVALID_EXECUTION_LOG",
        `Execution log line ${lineNumber} has invalid decision`,
      );
    }

    const taskIndex = indexByTaskId.get(taskId);
    if (taskIndex === undefined) {
      throw new PlanError(
        "INVALID_EXECUTION_LOG",
        `Execution log line ${lineNumber} references unknown taskId: ${taskId}`,
      );
    }

    if (taskIndex < lastTaskIndex) {
      throw new PlanError(
        "INVALID_EXECUTION_LOG",
        `Execution log line ${lineNumber} moves backwards in task order`,
      );
    }

    if (decision === "agent_applied") {
      if (!record.reviewStatus || !VALID_REVIEW_STATUSES.has(record.reviewStatus)) {
        throw new PlanError(
          "INVALID_EXECUTION_LOG",
          `Execution log line ${lineNumber} requires valid reviewStatus for agent_applied`,
        );
      }
    }

    lastTaskIndex = taskIndex;
    parsed.push({
      line: lineNumber,
      taskIndex,
      record: {
        timestamp,
        taskId,
        decision,
        ...(record.sessionId ? { sessionId: record.sessionId } : {}),
        ...(record.reviewStatus ? { reviewStatus: record.reviewStatus } : {}),
        ...(record.note ? { note: record.note } : {}),
      },
    });
  }

  return parsed;
}
