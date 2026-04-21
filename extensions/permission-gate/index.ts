import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { renderDiff } from "@mariozechner/pi-coding-agent";
import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  computeWriteDiffPreviewLocal,
  summarizeWriteForPrompt,
} from "./write-preview.ts";
import { computeEditsDiffLocalFallback } from "./edit-diff.ts";
import { loadComputeEditsDiffOnce } from "./edit-diff-loader.ts";
import { showDiffInCustomDialog } from "./diff-viewer.ts";
import {
  defaultOptionsForTool,
  isAlwaysAllowedTool,
  shouldBypassPromptForSession,
  supportsSessionAllow,
} from "./gate-policy.ts";
import { summarizeEditsForPrompt } from "./edit-preview.ts";
import {
  extractEditInput,
  extractPathFromInput,
  extractWriteInput,
} from "./tool-input.ts";
import {
  allowExecutionPrompt,
  readApprovalPrompt,
  APPROVAL_OPTION_BLOCK,
  APPROVAL_OPTION_EXPLAIN_COMMAND,
  APPROVAL_OPTION_READ_ONCE,
  APPROVAL_OPTION_REVIEW_NVIM,
  APPROVAL_OPTION_RUN_HIGH_RISK_ONCE,
  APPROVAL_OPTION_RUN_ONCE,
  APPROVAL_OPTION_VIEW_DIFF,
  APPROVAL_OPTION_YES,
  APPROVAL_OPTION_YES_SESSION,
  BASH_HIGH_RISK_APPROVAL_OPTIONS,
  BASH_SIMPLE_APPROVAL_OPTIONS,
  DENY_REASON_LABEL,
  DENY_REASON_PLACEHOLDER,
  DIFF_APPROVAL_OPTIONS,
  REVIEW_OPTION_APPLY,
  REVIEW_OPTION_BACK,
  RUN_CONFIRM_LABEL,
  RUN_CONFIRM_PLACEHOLDER,
  bashHighRiskPrompt,
  bashRunConfirmationPrompt,
  bashSimplePrompt,
  diffViewedPrompt,
  neovimReviewChangedPrompt,
  neovimUnavailablePrompt,
  previewUnavailablePrompt,
  previewUnavailableWithSourcePrompt,
  unexpectedPreviewErrorPrompt,
} from "./prompt-messages.ts";
import { reviewInNeovim, type NeovimReviewAdapters } from "./neovim-review.ts";
import { evaluatePermission, loadPermissionState } from "./permission-rules.ts";
import { generateBashExplanation } from "./bash-explain.ts";
import { assessReadRequest } from "./read-policy.ts";
import { classifyBashRisk } from "./bash-risk.ts";
import { registerPgateCommand } from "./pgate-command.ts";

export { computeWriteDiffPreviewLocal, summarizeWriteForPrompt };
export type { WritePreviewResult } from "./write-preview.ts";

// Note: computeEditsDiff is an internal utility not exported by the public
// package API. We try to resolve it dynamically from the installed
// @mariozechner/pi-coding-agent package at runtime. If that fails, we use a
// local fallback diff computation (exact-match based) so users still get a
// meaningful preview.

// Small permission gate for potentially dangerous tools. Prompts the user
// for confirmation before allowing execution. Keeps an in-memory session
// allow-list for the current agent process ("Always allow this session").

type SelectFn = (
  prompt: string,
  options: string[],
  opts?: unknown,
) => Promise<string | undefined>;
type InputFn = (
  label: string,
  placeholder?: string,
) => Promise<string | undefined>;
type NotifyFn = (message: string, level?: "info" | "warning" | "error") => void;

type GateUI = {
  select?: SelectFn;
  input?: InputFn;
  notify?: NotifyFn;
};

type GateCtx = {
  hasUI?: boolean;
  ui?: GateUI;
  cwd?: string;
  neovimReviewAdapters?: NeovimReviewAdapters;
};

type ApprovalLoopResult =
  | { type: "choice"; choice: string | undefined }
  | {
      type: "apply-reviewed";
      filePath: string;
      proposedContent: string;
      reviewedContent: string;
    };

type GateCtxWithSelectUI = GateCtx & {
  hasUI: true;
  ui: GateUI & { select: SelectFn };
};

function hasSelectUI(ctx: GateCtx): ctx is GateCtxWithSelectUI {
  return Boolean(ctx.hasUI && ctx.ui && typeof ctx.ui.select === "function");
}

async function askOptionalDenyReason(ctx: GateCtxWithSelectUI) {
  try {
    if (typeof ctx.ui.input === "function") {
      return await ctx.ui.input(DENY_REASON_LABEL, DENY_REASON_PLACEHOLDER);
    }
  } catch {
    // ignore input errors
  }

  return undefined;
}

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

async function buildProposedEditContent(
  cwd: string,
  filePath: string,
  edits: Array<{ oldText?: unknown; newText?: unknown }>,
) {
  const absolutePath = nodePath.resolve(cwd, filePath);
  const originalContent = await fs.readFile(absolutePath, "utf-8");

  const normalized = edits.map((edit, idx) => {
    if (typeof edit?.oldText !== "string" || edit.oldText.length === 0) {
      throw new Error(`edits[${idx}].oldText must be a non-empty string.`);
    }
    if (typeof edit?.newText !== "string") {
      throw new Error(`edits[${idx}].newText must be a string.`);
    }
    return { oldText: edit.oldText, newText: edit.newText, idx };
  });

  const matches = normalized.map((edit) => {
    const first = originalContent.indexOf(edit.oldText);
    if (first === -1) {
      throw new Error(
        `Could not find edits[${edit.idx}].oldText in ${filePath}.`,
      );
    }
    const second = originalContent.indexOf(edit.oldText, first + 1);
    if (second !== -1) {
      throw new Error(
        `edits[${edit.idx}].oldText must be unique in ${filePath}.`,
      );
    }
    return { ...edit, start: first, end: first + edit.oldText.length };
  });

  const ordered = [...matches].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i - 1]!.end > ordered[i]!.start) {
      throw new Error("Edit ranges overlap.");
    }
  }

  let proposed = originalContent;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const edit = ordered[i]!;
    proposed =
      proposed.slice(0, edit.start) + edit.newText + proposed.slice(edit.end);
  }

  return proposed;
}

function hasAiComments(content: string) {
  return /\bai:/.test(content);
}

async function applyReviewedVersion(params: {
  reviewedContent: string;
  proposedContent: string;
  absolutePath: string;
  filePath: string;
  pi: ExtensionAPI;
}) {
  const { reviewedContent, proposedContent, absolutePath, filePath, pi } =
    params;

  if (reviewedContent === proposedContent) {
    return undefined;
  }

  await fs.writeFile(absolutePath, reviewedContent, "utf-8");

  if (hasAiComments(reviewedContent)) {
    pi.sendUserMessage(
      `I reviewed and updated \`${filePath}\` in Neovim and left \`ai:\` comments. ` +
        "Re-read the file, follow every ai: instruction, and remove all ai: comment lines.",
      { deliverAs: "steer" },
    );

    return {
      block: true,
      reason:
        "Blocked: ai-guided reviewed version was applied manually. Re-read the file, follow ai: instructions, and remove ai: comment lines.",
    } as const;
  }

  return {
    block: true,
    reason:
      "Blocked: reviewed version was applied manually in Neovim and written to disk.",
  } as const;
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

  async function runEditApprovalLoop(
    ctx: GateCtxWithSelectUI,
    input: unknown,
    initialPromptMsg: string,
  ): Promise<ApprovalLoopResult> {
    const { path, edits } = extractEditInput(input);
    const editOptions = [...DIFF_APPROVAL_OPTIONS];

    let promptMsg = initialPromptMsg;
    while (true) {
      const choice = await ctx.ui.select(promptMsg, editOptions);
      if (choice === APPROVAL_OPTION_REVIEW_NVIM) {
        if (!path || !edits) {
          promptMsg = previewUnavailablePrompt(
            "edit",
            "missing path/edits input.",
          );
          continue;
        }

        try {
          const cwd = ctx.cwd ?? process.cwd();
          const proposedContent = await buildProposedEditContent(
            cwd,
            path,
            edits,
          );
          const reviewResult = await reviewInNeovim({
            cwd,
            filePath: path,
            proposedContent,
            adapters: ctx.neovimReviewAdapters,
          });

          if (reviewResult.status === "unavailable") {
            promptMsg = neovimUnavailablePrompt("edit", reviewResult.reason);
            continue;
          }
          if (reviewResult.status === "no-change") {
            promptMsg = initialPromptMsg;
            continue;
          }

          const reviewChoice = await ctx.ui.select(
            neovimReviewChangedPrompt("edit"),
            [REVIEW_OPTION_APPLY, REVIEW_OPTION_BACK],
          );

          if (reviewChoice === REVIEW_OPTION_APPLY) {
            return {
              type: "apply-reviewed",
              filePath: path,
              proposedContent,
              reviewedContent: reviewResult.reviewedContent,
            };
          }

          promptMsg = initialPromptMsg;
          continue;
        } catch (err) {
          promptMsg = neovimUnavailablePrompt("edit", String(err));
          continue;
        }
      }

      if (choice !== APPROVAL_OPTION_VIEW_DIFF)
        return { type: "choice", choice };

      if (!path || !edits) {
        promptMsg = previewUnavailablePrompt(
          "edit",
          "missing path/edits input.",
        );
        continue;
      }

      try {
        const loaded = await loadComputeEditsDiffOnce();
        const cwd = ctx.cwd ?? process.cwd();
        const engine = loaded.source;
        const diffRes = loaded.fn
          ? await loaded.fn(path, edits, cwd)
          : await computeEditsDiffLocalFallback(path, edits, cwd);

        if (!("error" in diffRes) && diffRes?.diff) {
          const rendered = renderDiff(diffRes.diff, { filePath: path });
          await showDiffInCustomDialog(ctx, path, rendered);
          promptMsg = diffViewedPrompt("edit", engine);
        } else if ("error" in diffRes) {
          const errMsg = String(diffRes.error ?? "Preview unavailable");
          const meta = summarizeEditsForPrompt(edits, path);
          promptMsg = previewUnavailableWithSourcePrompt(
            "edit",
            engine,
            errMsg,
            meta,
          );
        }
      } catch {
        promptMsg = unexpectedPreviewErrorPrompt("edit");
      }
    }
  }

  async function runWriteApprovalLoop(
    ctx: GateCtxWithSelectUI,
    input: unknown,
    initialPromptMsg: string,
  ): Promise<ApprovalLoopResult> {
    const { path, content } = extractWriteInput(input);
    const writeOptions = [...DIFF_APPROVAL_OPTIONS];

    let promptMsg = initialPromptMsg;
    while (true) {
      const choice = await ctx.ui.select(promptMsg, writeOptions);
      if (choice === APPROVAL_OPTION_REVIEW_NVIM) {
        if (!path || typeof content !== "string") {
          const reason = !path ? "missing path input" : "missing content input";
          const meta = summarizeWriteForPrompt({ path, content });
          promptMsg = previewUnavailablePrompt("write", `${reason}.`, meta);
          continue;
        }

        const cwd = ctx.cwd ?? process.cwd();
        const reviewResult = await reviewInNeovim({
          cwd,
          filePath: path,
          proposedContent: content,
          adapters: ctx.neovimReviewAdapters,
        });

        if (reviewResult.status === "unavailable") {
          promptMsg = neovimUnavailablePrompt("write", reviewResult.reason);
          continue;
        }
        if (reviewResult.status === "no-change") {
          promptMsg = initialPromptMsg;
          continue;
        }

        const reviewChoice = await ctx.ui.select(
          neovimReviewChangedPrompt("write"),
          [REVIEW_OPTION_APPLY, REVIEW_OPTION_BACK],
        );

        if (reviewChoice === REVIEW_OPTION_APPLY) {
          return {
            type: "apply-reviewed",
            filePath: path,
            proposedContent: content,
            reviewedContent: reviewResult.reviewedContent,
          };
        }

        promptMsg = initialPromptMsg;
        continue;
      }
      if (choice !== APPROVAL_OPTION_VIEW_DIFF)
        return { type: "choice", choice };

      if (!path || typeof content !== "string") {
        const reason = !path ? "missing path input" : "missing content input";
        const meta = summarizeWriteForPrompt({ path, content });
        promptMsg = previewUnavailablePrompt("write", `${reason}.`, meta);
        continue;
      }

      try {
        const cwd = ctx.cwd ?? process.cwd();
        const diffRes = await computeWriteDiffPreviewLocal(path, content, cwd);

        if (!("error" in diffRes) && diffRes.diff) {
          const rendered = renderDiff(diffRes.diff, { filePath: path });
          await showDiffInCustomDialog(ctx, path, rendered);
          const mode = diffRes.existedBeforeWrite ? "overwrite" : "create";
          promptMsg = diffViewedPrompt("write", `write:${mode}`);
        } else {
          const errMsg =
            "error" in diffRes ? diffRes.error : "Preview unavailable";
          const meta = summarizeWriteForPrompt({
            path,
            content,
            existedBeforeWrite:
              "existedBeforeWrite" in diffRes
                ? diffRes.existedBeforeWrite
                : undefined,
            oldChars: "oldChars" in diffRes ? diffRes.oldChars : undefined,
            newChars: "newChars" in diffRes ? diffRes.newChars : undefined,
          });
          promptMsg = previewUnavailableWithSourcePrompt(
            "write",
            "write:local",
            errMsg,
            meta,
          );
        }
      } catch {
        promptMsg = unexpectedPreviewErrorPrompt("write");
      }
    }
  }

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

      const promptMsg = allowExecutionPrompt(tool);

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
