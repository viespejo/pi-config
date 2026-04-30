import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import nodePath from "node:path";
import {
  computeWriteDiffPreviewLocal,
  summarizeWriteForPrompt,
} from "./write-preview.ts";
import { loadComputeEditsDiffOnce } from "./edit-diff-loader.ts";
import {
  applyReviewedVersion,
  askOptionalDenyReason,
  hasSelectUI,
  runEditApprovalLoop,
  runWriteApprovalLoop,
  type GateCtx,
} from "./approval-flow.ts";
import {
  defaultOptionsForTool,
  isAlwaysAllowedTool,
  shouldBypassPromptForSession,
  supportsSessionAllow,
} from "./gate-policy.ts";
import { extractPathFromInput } from "./tool-input.ts";
import {
  allowExecutionPrompt,
  readApprovalPrompt,
  APPROVAL_OPTION_BLOCK,
  APPROVAL_OPTION_EXPLAIN_COMMAND,
  APPROVAL_OPTION_READ_ONCE,
  APPROVAL_OPTION_RUN_HIGH_RISK_ONCE,
  APPROVAL_OPTION_RUN_ONCE,
  APPROVAL_OPTION_YES,
  APPROVAL_OPTION_YES_SESSION,
  BASH_HIGH_RISK_APPROVAL_OPTIONS,
  BASH_SIMPLE_APPROVAL_OPTIONS,
  RUN_CONFIRM_LABEL,
  RUN_CONFIRM_PLACEHOLDER,
  bashHighRiskPrompt,
  bashRunConfirmationPrompt,
  bashSimplePrompt,
} from "./prompt-messages.ts";
import { evaluatePermission, loadPermissionState } from "./permission-rules.ts";
import { generateBashExplanation } from "./bash-explain.ts";
import { assessReadRequest } from "./read-policy.ts";
import { classifyBashRisk } from "./bash-risk.ts";
import { registerPgateCommand } from "./pgate-command.ts";

export { computeWriteDiffPreviewLocal, summarizeWriteForPrompt };
export type { WritePreviewResult } from "./write-preview.ts";

// Small permission gate for potentially dangerous tools. Prompts the user
// for confirmation before allowing execution. Keeps an in-memory session
// allow-list for the current agent process ("Always allow this session").

function blockedByUserReason(userReason?: string) {
  return userReason
    ? `Blocked by user. Reason: ${userReason}`
    : "Blocked by user";
}

function mergeAndDedupeRisks(primary: string[], secondary: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const raw of [...primary, ...secondary]) {
    const item = raw.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

export default function (pi: ExtensionAPI) {
  // Edit diff preview is shown in a dedicated custom dialog (lazy, on demand).

  // In-memory allow list for the running session. If the user chooses
  // "always allow for this session" we add the tool name here and skip prompts.
  const sessionAllow = new Set<string>();

  let warmupStarted = false;
  let internalDiffFallbackNotified = false;
  pi.on("session_start", async (_event, ctx) => {
    if (warmupStarted) return;
    warmupStarted = true;
    // Warm up internal diff loader early so the first edit confirmation has less latency.
    const loaded = await loadComputeEditsDiffOnce();
    if (!loaded.fn && !internalDiffFallbackNotified) {
      internalDiffFallbackNotified = true;
      const gateCtx = ctx as unknown as GateCtx;
      try {
        if (gateCtx?.hasUI && gateCtx?.ui?.notify) {
          gateCtx.ui.notify(
            "permission-gate: using local diff fallback (internal edit-diff not found).",
            "warning",
          );
        }
      } catch {
        // best effort only
      }
    }
  });

  registerPgateCommand(pi, sessionAllow);

  pi.on("tool_call", async (event, ctx) => {
    const gateCtx = ctx as unknown as GateCtx;
    const typedEvent = event as { toolName?: string; input?: unknown };
    const tool = typedEvent.toolName ?? "tool";

    if (tool === "read") {
      const cwd = gateCtx.cwd ?? process.cwd();
      const readPath = extractPathFromInput(typedEvent.input as any);
      if (typeof readPath !== "string" || readPath.trim().length === 0) {
        return {
          block: true,
          reason: "Blocked: invalid read input (missing path).",
        };
      }

      const permissionState = loadPermissionState(cwd);
      const configured = evaluatePermission(
        "read",
        { path: readPath, file_path: readPath },
        cwd,
        permissionState,
      );

      const readRisk = await assessReadRequest(readPath, cwd);

      if (readRisk.hardDenyReason) {
        return {
          block: true,
          reason: `Blocked: hard-deny read policy for ${readRisk.pathLabel}. ${readRisk.hardDenyReason}`,
        };
      }

      if (configured.action === "deny") {
        return {
          block: true,
          reason: configured.reason ?? "Blocked by configured read deny rule.",
        };
      }

      const askReasons = [...readRisk.askReasons];
      if (configured.action === "ask" && configured.reason) {
        askReasons.push(configured.reason);
      }

      if (askReasons.length > 0) {
        if (!hasSelectUI(gateCtx)) {
          return {
            block: true,
            reason: "Blocked: no UI available for confirmation",
          };
        }

        let choice: string | undefined;
        try {
          choice = await gateCtx.ui.select(
            readApprovalPrompt(
              readRisk.pathLabel,
              mergeAndDedupeRisks(askReasons, []),
            ),
            [APPROVAL_OPTION_READ_ONCE, APPROVAL_OPTION_BLOCK],
          );
        } catch (err) {
          return {
            block: true,
            reason: `Blocked: ui.select failed (${String(err)})`,
          };
        }

        if (choice !== APPROVAL_OPTION_READ_ONCE) {
          const userReason = await askOptionalDenyReason(gateCtx);
          return {
            block: true,
            reason: blockedByUserReason(userReason),
          };
        }

        return;
      }

      if (configured.action === "allow" || configured.action === "default") {
        return;
      }

      return;
    }

    if (isAlwaysAllowedTool(tool)) return;
    if (shouldBypassPromptForSession(tool, sessionAllow)) return; // already allowed for this session

    if (tool === "bash") {
      const cwd = gateCtx.cwd ?? process.cwd();
      const command =
        typedEvent.input &&
        typeof typedEvent.input === "object" &&
        typeof (typedEvent.input as Record<string, unknown>).command ===
          "string"
          ? String((typedEvent.input as Record<string, unknown>).command)
          : "";

      const risk = classifyBashRisk(command, cwd);
      if (risk.hardDenyReason) {
        return {
          block: true,
          reason: `Blocked: hard-deny policy. ${risk.hardDenyReason}`,
        };
      }

      const permissionState = loadPermissionState(cwd);
      const configured = evaluatePermission(
        "bash",
        { command },
        cwd,
        permissionState,
      );
      if (configured.action === "deny") {
        return {
          block: true,
          reason: configured.reason ?? "Blocked by configured bash deny rule.",
        };
      }

      const requiresHighRiskConfirmation = risk.highRisk;

      if (configured.action === "allow" && !requiresHighRiskConfirmation) {
        return;
      }

      if (!hasSelectUI(gateCtx)) {
        return {
          block: true,
          reason: "Blocked: no UI available for confirmation",
        };
      }

      const policyAndRiskReasons = requiresHighRiskConfirmation
        ? [
            ...(configured.reason ? [configured.reason] : []),
            ...risk.highRiskReasons,
          ]
        : configured.reason
          ? [configured.reason]
          : [];

      let lastExplanation:
        | {
            summary: string;
            risks: string[];
            impact: string;
            recommendation: "safe-ish" | "caution" | "dangerous";
            flags?: string[];
            commandWasTruncated?: boolean;
          }
        | undefined;

      let cachedExplanationForCommand:
        | {
            command: string;
            data: {
              summary: string;
              risks: string[];
              impact: string;
              recommendation: "safe-ish" | "caution" | "dangerous";
              flags?: string[];
              commandWasTruncated?: boolean;
            };
          }
        | undefined;

      let bashChoice: string | undefined;
      while (true) {
        try {
          const prompt = requiresHighRiskConfirmation
            ? bashHighRiskPrompt(command, policyAndRiskReasons, lastExplanation)
            : bashSimplePrompt(command, configured.reason, lastExplanation);
          const options = requiresHighRiskConfirmation
            ? [...BASH_HIGH_RISK_APPROVAL_OPTIONS]
            : [...BASH_SIMPLE_APPROVAL_OPTIONS];

          bashChoice = await gateCtx.ui.select(prompt, options);
        } catch (err) {
          return {
            block: true,
            reason: `Blocked: ui.select failed (${String(err)})`,
          };
        }

        if (bashChoice !== APPROVAL_OPTION_EXPLAIN_COMMAND) {
          break;
        }

        if (
          cachedExplanationForCommand &&
          cachedExplanationForCommand.command === command
        ) {
          lastExplanation = cachedExplanationForCommand.data;
          continue;
        }

        const explanationResult = await generateBashExplanation({
          command,
          cwd,
          ctx,
          configuredReason: configured.reason,
          highRiskReasons: risk.highRiskReasons,
        });

        if (!explanationResult.ok) {
          gateCtx.ui.notify?.(
            `Could not explain command: ${explanationResult.error.message}`,
            "warning",
          );
          continue;
        }

        const mergedRisks = mergeAndDedupeRisks(
          explanationResult.explanation.risks,
          policyAndRiskReasons,
        );

        const normalized = {
          summary: explanationResult.explanation.summary,
          risks: mergedRisks,
          impact: explanationResult.explanation.impact,
          recommendation: explanationResult.explanation.recommendation,
          ...(explanationResult.explanation.flags
            ? { flags: explanationResult.explanation.flags }
            : {}),
          ...(explanationResult.meta.commandWasTruncated
            ? { commandWasTruncated: true }
            : {}),
        };

        cachedExplanationForCommand = {
          command,
          data: normalized,
        };
        lastExplanation = normalized;
      }

      if (requiresHighRiskConfirmation) {
        if (bashChoice !== APPROVAL_OPTION_RUN_HIGH_RISK_ONCE) {
          const userReason = await askOptionalDenyReason(gateCtx);
          return { block: true, reason: blockedByUserReason(userReason) };
        }

        try {
          const typed =
            typeof gateCtx.ui.input === "function"
              ? await gateCtx.ui.input(
                  RUN_CONFIRM_LABEL,
                  RUN_CONFIRM_PLACEHOLDER,
                )
              : undefined;
          if (typed !== "RUN" && typed !== "run" && typed !== "asd") {
            // allow "asd" as personal easter egg confirmation
            return {
              block: true,
              reason: `Blocked: high-risk confirmation failed. ${bashRunConfirmationPrompt()}`,
            };
          }
          return;
        } catch {
          return {
            block: true,
            reason: "Blocked: high-risk confirmation failed.",
          };
        }
      }

      if (bashChoice !== APPROVAL_OPTION_RUN_ONCE) {
        const userReason = await askOptionalDenyReason(gateCtx);
        return {
          block: true,
          reason: blockedByUserReason(userReason),
        };
      }

      return;
    }

    // If no UI is available, be conservative and block the call
    if (!hasSelectUI(gateCtx)) {
      return {
        block: true,
        reason: "Blocked: no UI available for confirmation",
      };
    }

    // Use a select so the user can allow permanently for this session (not available for bash)
    let choice: string | undefined;
    try {
      const defaultOptions = defaultOptionsForTool(tool);

      const promptMsg =
        tool === "edit" || tool === "write"
          ? allowExecutionPrompt(
              tool,
              extractPathFromInput(typedEvent.input as any),
            )
          : allowExecutionPrompt(tool);

      if (tool === "edit") {
        const editResult = await runEditApprovalLoop(
          gateCtx,
          typedEvent.input,
          promptMsg,
        );
        if (editResult.type === "apply-reviewed") {
          const absolutePath = nodePath.resolve(
            gateCtx.cwd ?? process.cwd(),
            editResult.filePath,
          );
          const applied = await applyReviewedVersion({
            reviewedContent: editResult.reviewedContent,
            proposedContent: editResult.proposedContent,
            absolutePath,
            filePath: editResult.filePath,
            pi,
          });
          if (applied) return applied;
        } else {
          choice = editResult.choice;
        }
      } else if (tool === "write") {
        const writeResult = await runWriteApprovalLoop(
          gateCtx,
          typedEvent.input,
          promptMsg,
        );
        if (writeResult.type === "apply-reviewed") {
          const absolutePath = nodePath.resolve(
            gateCtx.cwd ?? process.cwd(),
            writeResult.filePath,
          );
          const applied = await applyReviewedVersion({
            reviewedContent: writeResult.reviewedContent,
            proposedContent: writeResult.proposedContent,
            absolutePath,
            filePath: writeResult.filePath,
            pi,
          });
          if (applied) return applied;
        } else {
          choice = writeResult.choice;
        }
      } else {
        choice = await gateCtx.ui.select(promptMsg, defaultOptions);
      }
    } catch (err) {
      // If UI threw for some reason, be conservative and block
      return {
        block: true,
        reason: `Blocked: ui.select failed (${String(err)})`,
      };
    }

    if (choice === APPROVAL_OPTION_YES_SESSION) {
      if (supportsSessionAllow(tool)) {
        sessionAllow.add(tool);
      }
      return; // allow this call and future calls for session
    }

    if (choice !== APPROVAL_OPTION_YES) {
      const userReason = await askOptionalDenyReason(gateCtx);
      return {
        block: true,
        reason: blockedByUserReason(userReason),
      };
    }

    // If choice === "Yes" we simply allow the call by returning nothing
  });
}
