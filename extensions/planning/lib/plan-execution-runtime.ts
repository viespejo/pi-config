import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PLAN_LOG_TASK_TERMINAL_TOOL = "plan_log_task_terminal";
export const PLAN_EXECUTION_CONTEXT_ENTRY_TYPE = "plan-execution-context";

export interface PlanExecutionContextEntry {
  planSlug: string;
  executionLogPath: string;
  sessionId?: string;
  taskIds: string[];
}

export function activatePlanLogTool(pi: ExtensionAPI): void {
  const active = new Set(pi.getActiveTools());
  active.add(PLAN_LOG_TASK_TERMINAL_TOOL);
  pi.setActiveTools(Array.from(active));
}

export function deactivatePlanLogTool(pi: ExtensionAPI): void {
  const active = new Set(pi.getActiveTools());
  active.delete(PLAN_LOG_TASK_TERMINAL_TOOL);
  pi.setActiveTools(Array.from(active));
}
