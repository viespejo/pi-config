/**
 * Shared execution flow for plans.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { checkDependencies, findDependencyCycle, PlanError } from "./plan-utils";
import {
  createPlanExecutionWidget,
  PLAN_EXECUTION_ENTRY_TYPE,
} from "./plan-widget";
import { EXECUTE_PLAN_PROMPT } from "./prompts/execute-plan-prompt";
import { appendPlanTelemetryEvent } from "./telemetry";
import type { PlanInfo } from "./types";
import type { PlanService } from "./plan-service";

function hasSessionMessages(ctx: ExtensionCommandContext): boolean {
  const entries = ctx.sessionManager.getEntries();
  return entries.some((e) => e.type === "message");
}

function sessionIdFromContext(ctx: ExtensionCommandContext): string {
  return ctx.sessionManager.getSessionFile();
}

export async function executePlanFlow(
  plan: PlanInfo,
  plans: PlanInfo[],
  planService: PlanService,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
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

  if (hasSessionMessages(ctx)) {
    const choice = await ctx.ui.select(
      "Session has existing messages. Where should the plan execute?",
      ["Create new linked session", "Execute in current session"],
    );

    if (choice === undefined) return;

    if (choice === "Create new linked session") {
      const parentSession = ctx.sessionManager.getSessionFile();
      const result = await ctx.newSession({ parentSession });
      if (result.cancelled) {
        ctx.ui.notify("New session creation was cancelled", "info");
        return;
      }
    }
  }

  if (planTitle) {
    pi.setSessionName(planTitle);
  }

  const currentSessionId = sessionIdFromContext(ctx);

  try {
    await planService.assignPlanSession(plan.path, currentSessionId);
    await planService.updatePlanStatus(plan.path, "in-progress");
  } catch (error) {
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
    sessionId: currentSessionId,
  });

  const planContent = await planService.readPlan(plan.path);
  pi.sendUserMessage(
    `${EXECUTE_PLAN_PROMPT}<plan>\n${planContent}\n</plan>\n\nPlan filename: ${plan.filename}`,
  );
}
