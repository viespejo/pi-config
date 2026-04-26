/**
 * List Plans Command
 *
 * Lists available plans and provides actions to edit, execute, or archive.
 *
 * Usage:
 *   /plan:list
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { loadConfig, getConfig } from "../lib/config";

import { executePlanFlow } from "../lib/execute-plan";
import { createPlanRepository } from "../lib/plan-repository";
import { createPlanService } from "../lib/plan-service";
import type { ArchiveResult } from "../lib/plan-selector";
import { selectPlan } from "../lib/plan-selector";
import type { PlanInfo } from "../lib/types";

/**
 * Archive a plan by moving it to the configured archive directory.
 * If the archive directory is a git repo, stages, commits, and pushes.
 */
async function archivePlan(plan: PlanInfo): Promise<ArchiveResult> {
  await loadConfig();
  const config = getConfig();

  if (!config.archiveDir) {
    return {
      ok: false,
      message:
        "Archive directory not configured. Set archiveDir in ~/.pi/agent/extensions/planning.json",
    };
  }

  const archiveDir = path.resolve(config.archiveDir);
  const filename = path.basename(plan.path);
  const title = plan.title?.trim() || plan.slug || plan.filename;

  try {
    await fs.mkdir(archiveDir, { recursive: true });
    await fs.rename(plan.path, path.join(archiveDir, filename));

    // Check if archive directory is a git repo
    const gitDir = path.join(archiveDir, ".git");
    try {
      await fs.access(gitDir);
    } catch {
      return { ok: true, message: `Archived ${title}` };
    }

    // Git operations
    const git = (args: string[]) => {
      const result = spawnSync("git", args, {
        cwd: archiveDir,
        encoding: "utf-8",
      });
      return result.status === 0;
    };

    if (!git(["add", filename])) {
      return { ok: true, message: `Archived ${title} (failed to stage)` };
    }

    if (!git(["commit", "-m", `Archive plan: ${filename}`, "--quiet"])) {
      return { ok: true, message: `Archived ${title} (failed to commit)` };
    }

    if (!git(["push", "--quiet"])) {
      return { ok: true, message: `Archived ${title} (failed to push)` };
    }

    return { ok: true, message: `Archived ${title}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Failed to archive: ${msg}` };
  }
}

/**
 * Open a plan in the editor.
 */
async function editPlan(
  planPath: string,
  planTitle: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const editor = process.env.VISUAL || process.env.EDITOR;

  if (!editor) {
    ctx.ui.notify("Set $VISUAL or $EDITOR to edit plans", "error");
    return;
  }

  const exitCode = await ctx.ui.custom<number | null>(
    (tui, _theme, _kb, done) => {
      tui.stop();

      const [editorBin, ...editorArgs] = editor.split(" ");
      const result = spawnSync(editorBin ?? editor, [...editorArgs, planPath], {
        stdio: "inherit",
        env: process.env,
      });

      tui.start();
      tui.requestRender(true);

      done(result.status);

      return { render: () => [], invalidate: () => {} };
    },
  );

  // RPC fallback: editor requires interactive TUI
  if (exitCode === undefined) {
    ctx.ui.notify("Editing plans requires interactive mode", "info");
    return;
  }

  if (exitCode !== 0) {
    ctx.ui.notify("Editor exited with errors", "error");
    return;
  }

  ctx.ui.notify(`Closed editor for ${planTitle}`, "info");
}

export function setupListPlansCommand(pi: ExtensionAPI) {
  pi.registerCommand("plan:list", {
    description: "List plans with options to edit, execute, or archive",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("plan:list requires interactive mode", "error");
        return;
      }

      await ctx.waitForIdle();
      await loadConfig();
      const { plansDir } = getConfig();

      const repository = createPlanRepository(ctx.cwd, { plansDir });
      const planService = createPlanService(repository);
      const plans = await planService.listPlans();

      if (plans.length === 0) {
        ctx.ui.notify(
          "No plans found in configured plans directory",
          "warning",
        );
        return;
      }

      const plan = await selectPlan(ctx, plans, archivePlan);

      if (!plan) {
        return;
      }

      const planTitle = plan.title?.trim() || plan.slug || plan.filename;

      const choice = await ctx.ui.select(
        `What would you like to do with "${planTitle}"?`,
        ["Execute", "Edit"],
      );

      if (choice === undefined) {
        return;
      }

      if (choice === "Execute") {
        await executePlanFlow(plan, plans, planService, ctx, pi);
      } else {
        await editPlan(plan.path, planTitle, ctx);
      }
    },
  });
}
