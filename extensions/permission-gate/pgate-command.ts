import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  evaluatePermission,
  loadPermissionState,
  parseTestExpression,
  reloadPermissionState,
  totalRuleCount,
} from "./permission-rules.ts";
import { classifyBashRisk } from "./bash-risk.ts";
import { assessReadRequest } from "./read-policy.ts";

type NotifyLevel = "info" | "warning" | "error";

function notifyCommand(ctx: any, message: string, level: NotifyLevel = "info") {
  try {
    if (ctx?.ui?.notify) {
      ctx.ui.notify(message, level);
      return;
    }
  } catch {
    // fallback below
  }
  console.log(`[permission-gate] ${level.toUpperCase()}: ${message}`);
}

export function registerPgateCommand(
  pi: ExtensionAPI,
  sessionAllow: Set<string>,
) {
  if (typeof (pi as any).registerCommand !== "function") {
    return;
  }

  pi.registerCommand("pgate", {
    description:
      "permission-gate operational command: status|test|reload|clear-session",
    handler: async (args, ctx) => {
      const raw = String(args ?? "").trim();
      const [subcommand, ...rest] =
        raw.length > 0 ? raw.split(/\s+/) : ["status"];
      const cwd = (ctx as any).cwd ?? process.cwd();

      if (subcommand === "status") {
        const state = loadPermissionState(cwd);
        const count = totalRuleCount(state);
        notifyCommand(
          ctx,
          `permission-gate status: source=${state.activeSource}, rules=${count} (allow=${state.merged.allow.length}, ask=${state.merged.ask.length}, deny=${state.merged.deny.length}), warnings=${state.warnings.length}`,
          "info",
        );
        return;
      }

      if (subcommand === "reload") {
        const state = reloadPermissionState(cwd);
        notifyCommand(
          ctx,
          `permission-gate reloaded: source=${state.activeSource}, rules=${totalRuleCount(state)}, warnings=${state.warnings.length}`,
          "info",
        );
        return;
      }

      if (subcommand === "clear-session") {
        const before = sessionAllow.size;
        sessionAllow.clear();
        notifyCommand(
          ctx,
          `permission-gate session allow-list cleared (${before} -> 0).`,
          "info",
        );
        return;
      }

      if (subcommand === "test") {
        const expression = rest.join(" ").trim();
        if (!expression) {
          notifyCommand(
            ctx,
            "Usage: /pgate test Bash(<command>) | Read(<path>)",
            "warning",
          );
          return;
        }

        const parsed = parseTestExpression(expression);
        const state = loadPermissionState(cwd);
        const verdict = evaluatePermission(
          parsed.toolName,
          parsed.input,
          cwd,
          state,
        );

        if (parsed.toolName === "bash") {
          const command =
            typeof parsed.input.command === "string" ? parsed.input.command : "";
          const risk = classifyBashRisk(command, cwd);
          const hardDeny = Boolean(risk.hardDenyReason);

          notifyCommand(
            ctx,
            `pgate test => tool=bash, action=${hardDeny ? "deny(hard-deny)" : verdict.action}, rule=${verdict.matchedRule ?? "none"}, highRisk=${risk.highRisk ? "yes" : "no"}${risk.highRiskReasons.length ? `, reasons=${risk.highRiskReasons.join(" | ")}` : ""}`,
            hardDeny ? "warning" : "info",
          );
          return;
        }

        if (parsed.toolName === "read") {
          const pathValue =
            typeof parsed.input.path === "string" ? parsed.input.path : "";
          const readRisk = await assessReadRequest(pathValue, cwd);
          const readAction = readRisk.hardDenyReason
            ? "deny(hard-deny)"
            : readRisk.askReasons.length > 0
              ? "ask"
              : verdict.action;
          const readReasons = readRisk.hardDenyReason
            ? [readRisk.hardDenyReason]
            : readRisk.askReasons;

          notifyCommand(
            ctx,
            `pgate test => tool=read, action=${readAction}, rule=${verdict.matchedRule ?? "none"}${readReasons.length ? `, reasons=${readReasons.join(" | ")}` : ""}`,
            readRisk.hardDenyReason ? "warning" : "info",
          );
          return;
        }

        notifyCommand(
          ctx,
          "Only Bash(...) and Read(...) expressions are supported.",
          "warning",
        );
        return;
      }

      notifyCommand(
        ctx,
        "Unknown /pgate subcommand. Use: status | test Bash(...) | test Read(...) | reload | clear-session",
        "warning",
      );
    },
  });
}
