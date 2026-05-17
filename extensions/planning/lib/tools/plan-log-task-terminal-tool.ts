import * as fs from "node:fs/promises";

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { PlanError } from "../errors.ts";
import {
  PLAN_EXECUTION_CONTEXT_ENTRY_TYPE,
  PLAN_LOG_TASK_TERMINAL_TOOL,
  type PlanExecutionContextEntry,
} from "../plan-execution-runtime.ts";
import type { PlanExecutionRecordV1 } from "../types.ts";

function getSessionExecutionContext(ctx: any): PlanExecutionContextEntry | null {
  const branch = ctx.sessionManager.getBranch();
  let found: PlanExecutionContextEntry | null = null;

  for (const entry of branch) {
    if (entry.type === "custom" && entry.customType === PLAN_EXECUTION_CONTEXT_ENTRY_TYPE) {
      const data = entry.data as Partial<PlanExecutionContextEntry> | undefined;
      if (
        data?.planSlug &&
        data.executionLogPath &&
        Array.isArray(data.taskIds)
      ) {
        found = {
          planSlug: data.planSlug,
          executionLogPath: data.executionLogPath,
          ...(data.sessionId ? { sessionId: data.sessionId } : {}),
          taskIds: data.taskIds,
        };
      }
    }
  }

  return found;
}

const planLogTaskTerminalTool = defineTool({
  name: PLAN_LOG_TASK_TERMINAL_TOOL,
  label: "Plan Log Task Terminal",
  description:
    "Append a terminal execution-log record for the current /plan:execute task.",
  promptSnippet: "Append terminal task decisions to execution log via runtime",
  promptGuidelines: [
    "Use plan_log_task_terminal exactly once per processed task terminal outcome (skipped or reviewed apply).",
    "Use plan_log_task_terminal instead of direct file writes for execution log updates.",
  ],
  parameters: Type.Object({
    taskId: Type.String({ description: "Stable task id (e.g. task-2 or textual id)" }),
    decision: Type.Union([
      Type.Literal("agent_applied"),
      Type.Literal("skipped"),
    ]),
    reviewStatus: Type.Optional(
      Type.Union([
        Type.Literal("accepted"),
        Type.Literal("amended_manually"),
      ]),
    ),
    note: Type.Optional(Type.String()),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const context = getSessionExecutionContext(ctx);
    if (!context) {
      throw new PlanError(
        "INVALID_EXECUTION_LOG",
        "Plan execution logging is not active",
      );
    }

    const taskId = params.taskId.trim();
    if (!taskId) {
      throw new PlanError("INVALID_EXECUTION_LOG", "taskId is required");
    }

    if (!context.taskIds.includes(taskId)) {
      throw new PlanError(
        "INVALID_EXECUTION_LOG",
        `Unknown taskId for active plan: ${taskId}`,
      );
    }

    if (params.decision === "agent_applied" && !params.reviewStatus) {
      throw new PlanError(
        "INVALID_EXECUTION_LOG",
        "reviewStatus is required when decision=agent_applied",
      );
    }

    if (params.decision === "skipped" && params.reviewStatus) {
      throw new PlanError(
        "INVALID_EXECUTION_LOG",
        "reviewStatus must not be provided when decision=skipped",
      );
    }

    const record: PlanExecutionRecordV1 = {
      timestamp: new Date().toISOString(),
      taskId,
      decision: params.decision,
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      ...(params.reviewStatus ? { reviewStatus: params.reviewStatus } : {}),
      ...(params.note ? { note: params.note } : {}),
    };

    await fs.appendFile(
      context.executionLogPath,
      `${JSON.stringify(record)}\n`,
      "utf-8",
    );

    return {
      content: [
        {
          type: "text",
          text: `Logged terminal task record: ${taskId} (${params.decision})`,
        },
      ],
      details: {
        planSlug: context.planSlug,
        executionLogPath: context.executionLogPath,
      },
    };
  },
});

export function setupPlanLogTaskTerminalTool(pi: ExtensionAPI) {
  pi.registerTool(planLogTaskTerminalTool);
}
