/**
 * Execute Plan Command
 *
 * Usage:
 *   /plan:execute
 *   /plan:execute <slug-or-filename>
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { executePlanFlow } from "../lib/execute-plan";
import { createPlanRepository } from "../lib/plan-repository";
import { createPlanService } from "../lib/plan-service";
import { selectPlan } from "../lib/plan-selector";
import { loadConfig, getConfig } from "../lib/config";

function normalizePlanRef(input: string): string {
  return input.trim().replace(/\.md$/i, "");
}

export function setupExecutePlanCommand(pi: ExtensionAPI) {
  pi.registerCommand("plan:execute", {
    description: "Execute a plan by selecting one or passing a slug",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("plan:execute requires interactive mode", "error");
        return;
      }

      await ctx.waitForIdle();
      await loadConfig();
      const { plansDir } = getConfig();
      const repository = createPlanRepository(ctx.cwd, { plansDir });
      const planService = createPlanService(repository);
      const plans = await planService.listPlans();

      if (plans.length === 0) {
        ctx.ui.notify("No plans found in configured plans directory", "warning");
        return;
      }

      const rawRef = args.trim();
      let plan = null;

      if (rawRef.length > 0) {
        const ref = normalizePlanRef(rawRef);
        plan =
          plans.find((p) => p.slug === ref || p.filename.replace(/\.md$/, "") === ref) ??
          null;

        if (!plan) {
          ctx.ui.notify(`Plan not found: ${rawRef}`, "error");
          return;
        }
      } else {
        plan = await selectPlan(ctx, plans);
        if (!plan) return;
      }

      await executePlanFlow(plan, plans, planService, ctx, pi);
    },
  });
}
