/**
 * Shared execution flow for plans.
 */

import {
  copyToClipboard,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { checkDependencies, findDependencyCycle } from "./dependencies.ts";
import { PlanError } from "./errors.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlanInfo } from "./types.ts";
import {
  createPlanExecutionWidget,
  PLAN_EXECUTION_ENTRY_TYPE,
} from "./plan-widget.ts";
import { appendPlanTelemetryEvent } from "./telemetry.ts";
import type { PlanService } from "./plan-service.ts";
import {
  buildExecutionLogFilename,
  buildExecutionLogPath,
  parseExecutionLogJsonl,
} from "./execution-log.ts";
import { resolveStableTaskIds } from "./dependencies.ts";
import {
  activatePlanLogTool,
  deactivatePlanLogTool,
  PLAN_EXECUTION_CONTEXT_ENTRY_TYPE,
} from "./plan-execution-runtime.ts";
import { buildClaudeCodeStrictApplyExecutePrompt } from "./prompts/execute-plan-claude-code-prompt.ts";

interface ParsedPlanTask {
  id?: string;
}

function parsePlanTasks(planContent: string): ParsedPlanTask[] {
  const taskBlocks = [...planContent.matchAll(/<task\b[^>]*>([\s\S]*?)<\/task>/g)];
  return taskBlocks.map((block) => {
    const attrs = block[0].match(/<task\b([^>]*)>/);
    const attrText = attrs?.[1] ?? "";
    const idMatch = attrText.match(/\bid\s*=\s*"([^"]+)"/) ?? attrText.match(/\btaskId\s*=\s*"([^"]+)"/);
    return { id: idMatch?.[1] };
  });
}

function sessionIdFromContext(
  ctx: ExtensionCommandContext,
): string | undefined {
  return ctx.sessionManager.getSessionFile();
}

export async function executePlanFlow(
  plan: PlanInfo,
  plans: PlanInfo[],
  planService: PlanService,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  executePrompt: string,
): Promise<void> {
  const planTitle = plan.title?.trim() || plan.slug;

  const depCheck = checkDependencies(plan, plans);
  if (depCheck.unresolved.length > 0) {
    const unresolvedList = depCheck.unresolved.join(", ");
    ctx.ui.notify(
      `Cannot execute: unresolved dependencies (${unresolvedList})`,
      "error",
    );
    return;
  }

  const cycle = findDependencyCycle(plan.slug, plans);
  if (cycle) {
    ctx.ui.notify(
      `Cannot execute: dependency cycle detected (${cycle.join(" -> ")})`,
      "error",
    );
    return;
  }

  if (planTitle) {
    pi.setSessionName(planTitle);
  }

  const currentSessionId = sessionIdFromContext(ctx);
  const planContent = await planService.readPlan(plan.path);

  const executionLogPath = buildExecutionLogPath(planService.getPlansPath(), plan.slug);
  const taskIds = resolveStableTaskIds(parsePlanTasks(planContent));
  let resumeNextTaskIndex = 0;

  try {
    await fs.access(executionLogPath);

    const resumeChoice = await ctx.ui.select(
      "Execution log detected for this plan. Resume from next pending task? (yes/no)",
      ["yes", "no"],
    );

    if (resumeChoice !== "yes") {
      ctx.ui.notify(
        `Execution aborted. Delete ${buildExecutionLogFilename(plan.slug)} to start from scratch.`,
        "info",
      );
      return;
    }

    const logContent = await fs.readFile(executionLogPath, "utf-8");
    const parsed = parseExecutionLogJsonl(logContent, taskIds);
    if (parsed.length > 0) {
      const maxTaskIndex = Math.max(...parsed.map((entry) => entry.taskIndex));
      resumeNextTaskIndex = maxTaskIndex + 1;
    }

    if (taskIds.length > 0 && resumeNextTaskIndex >= taskIds.length) {
      resumeNextTaskIndex = taskIds.length;
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code !== "ENOENT") {
      if (error instanceof PlanError) {
        ctx.ui.notify(
          `${error.message}. Manual execution log correction or deletion is required.`,
          "error",
        );
        return;
      }
      throw error;
    }
  }

  const resumeTaskNumber = resumeNextTaskIndex + 1;
  const resumeTaskId = taskIds[resumeNextTaskIndex];
  const executionAlreadyComplete = taskIds.length > 0 && resumeNextTaskIndex >= taskIds.length;
  const resumeInstruction = executionAlreadyComplete
    ? "Execution already reached the last task. Do not process any tasks. Run finalization only: read the summary template, create or update the plan SUMMARY, and present the execution complete message."
    : resumeTaskId
      ? `Resume execution at Task ${resumeTaskNumber} (id: ${resumeTaskId}). Do not process any previous task.`
      : `Start execution at Task ${resumeTaskNumber}.`;
  const resumeContext = `\n\n<runtime_resume_instruction>${resumeInstruction}</runtime_resume_instruction>`;

  let finalPrompt = `${executePrompt}\n\n<plan>\n${planContent}\n</plan>\n\n<plan_filename>${plan.filename}</plan_filename>${resumeContext}`;
  const extensionRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const executionLogCliCommand = `${process.execPath} ${path.join(extensionRoot, "bin", "planning-log.mjs")}`;

  if (ctx.hasUI) {
    const choice = await ctx.ui.select("/plan:execute · prompt delivery", [
      "Send now",
      "Preview/edit before sending",
      "Copy prompt to clipboard",
      "Copy Claude Code prompt to clipboard",
      "Cancel",
    ]);

    if (!choice || choice === "Cancel") {
      deactivatePlanLogTool(pi);
      ctx.ui.notify("/plan:execute cancelled", "info");
      return;
    }

    if (choice === "Preview/edit before sending") {
      const edited = await ctx.ui.editor(
        "Review/edit the prompt to be sent:",
        finalPrompt,
      );

      if (typeof edited !== "string") {
        deactivatePlanLogTool(pi);
        ctx.ui.notify("/plan:execute cancelled", "info");
        return;
      }

      if (!edited.trim()) {
        ctx.ui.notify("Empty prompt: /plan:execute cancelled", "warning");
        return;
      }

      finalPrompt = edited;
    }

    if (choice === "Copy prompt to clipboard") {
      try {
        copyToClipboard(finalPrompt);
        deactivatePlanLogTool(pi);
        ctx.ui.notify("Prompt copied to clipboard", "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to copy prompt: ${message}`, "error");
      }
      return;
    }

    if (choice === "Copy Claude Code prompt to clipboard") {
      const claudePrompt = `${buildClaudeCodeStrictApplyExecutePrompt({
        summaryTemplateReferencePath: path.join(extensionRoot, "lib", "references", "summary-template.md"),
        executionLogPath,
        executionLogCliCommand,
        allowedTaskIds: taskIds,
      })}\n\n<plan>\n${planContent}\n</plan>\n\n<plan_filename>${plan.filename}</plan_filename>${resumeContext}`;

      try {
        copyToClipboard(claudePrompt);
        deactivatePlanLogTool(pi);
        ctx.ui.notify("Claude Code prompt copied to clipboard", "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to copy Claude Code prompt: ${message}`, "error");
      }
      return;
    }
  }

  const executionContext = {
    planSlug: plan.slug,
    executionLogPath,
    ...(currentSessionId ? { sessionId: currentSessionId } : {}),
    taskIds,
  };

  pi.appendEntry(PLAN_EXECUTION_CONTEXT_ENTRY_TYPE, executionContext);
  activatePlanLogTool(pi);

  try {
    if (!executionAlreadyComplete) {
      await planService.updatePlanStatus(plan.path, "in-progress");
    }
  } catch (error) {
    deactivatePlanLogTool(pi);
    if (error instanceof PlanError) {
      ctx.ui.notify(`Cannot start plan: ${error.message}`, "error");
      return;
    }
    throw error;
  }

  const widgetState = { title: planTitle, filename: plan.filename };
  ctx.ui.setWidget("plan-execution", createPlanExecutionWidget(widgetState));
  pi.appendEntry(PLAN_EXECUTION_ENTRY_TYPE, widgetState);

  await appendPlanTelemetryEvent(planService.getPlansPath(), {
    timestamp: new Date().toISOString(),
    action: "execute_started",
    planPath: plan.path,
    planSlug: plan.slug,
    ...(currentSessionId ? { sessionId: currentSessionId } : {}),
  });

  pi.sendUserMessage(finalPrompt);
}
