import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { renderDiff } from "@mariozechner/pi-coding-agent";
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
import { extractEditInput, extractWriteInput } from "./tool-input.ts";

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
      try {
        if (ctx?.hasUI && ctx?.ui?.notify) {
          ctx.ui.notify(
            "permission-gate: using local diff fallback (internal edit-diff not found).",
            "warning",
          );
        }
      } catch {
        // best effort only
      }
    }
  });


  async function runEditApprovalLoop(
    ctx: any,
    input: any,
    initialPromptMsg: string,
  ) {
    const { path, edits } = extractEditInput(input);
    const editOptions = ["Yes", "View diff", "Yes, always this session", "No"];

    let promptMsg = initialPromptMsg;
    while (true) {
      const choice = await ctx.ui.select(promptMsg, editOptions);
      if (choice !== "View diff") return choice;

      if (!path || !edits) {
        promptMsg = `Tool: edit\n\nPreview unavailable: missing path/edits input.\n\nAllow execution?`;
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
          promptMsg = `Tool: edit\n\nDiff viewed (${engine}). Allow execution?`;
        } else if ("error" in diffRes) {
          const errMsg = String(diffRes.error ?? "Preview unavailable");
          const meta = summarizeEditsForPrompt(edits, path);
          promptMsg = `Tool: edit\n\nPreview unavailable (${engine}): ${errMsg}\n\n${meta}\n\nAllow execution?`;
        }
      } catch {
        promptMsg = `Tool: edit\n\nPreview unavailable due to an unexpected error.\n\nAllow execution?`;
      }
    }
  }

  async function runWriteApprovalLoop(
    ctx: any,
    input: any,
    initialPromptMsg: string,
  ) {
    const { path, content } = extractWriteInput(input);
    const writeOptions = ["Yes", "View diff", "Yes, always this session", "No"];

    let promptMsg = initialPromptMsg;
    while (true) {
      const choice = await ctx.ui.select(promptMsg, writeOptions);
      if (choice !== "View diff") return choice;

      if (!path || typeof content !== "string") {
        const reason = !path ? "missing path input" : "missing content input";
        const meta = summarizeWriteForPrompt({ path, content });
        promptMsg = `Tool: write\n\nPreview unavailable: ${reason}.\n\n${meta}\n\nAllow execution?`;
        continue;
      }

      try {
        const cwd = ctx.cwd ?? process.cwd();
        const diffRes = await computeWriteDiffPreviewLocal(path, content, cwd);

        if (!("error" in diffRes) && diffRes.diff) {
          const rendered = renderDiff(diffRes.diff, { filePath: path });
          await showDiffInCustomDialog(ctx, path, rendered);
          const mode = diffRes.existedBeforeWrite ? "overwrite" : "create";
          promptMsg = `Tool: write\n\nDiff viewed (write:${mode}). Allow execution?`;
        } else {
          const errMsg = "error" in diffRes ? diffRes.error : "Preview unavailable";
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
          promptMsg = `Tool: write\n\nPreview unavailable (write:local): ${errMsg}\n\n${meta}\n\nAllow execution?`;
        }
      } catch {
        promptMsg = `Tool: write\n\nPreview unavailable due to an unexpected error.\n\nAllow execution?`;
      }
    }
  }

  pi.on("tool_call", async (event, ctx) => {
    const tool = event.toolName ?? "tool";

    if (isAlwaysAllowedTool(tool)) return;
    if (shouldBypassPromptForSession(tool, sessionAllow)) return; // already allowed for this session

    // If no UI is available, be conservative and block the call
    if (!ctx.hasUI || !ctx.ui || typeof ctx.ui.select !== "function") {
      return {
        block: true,
        reason: "Blocked: no UI available for confirmation",
      };
    }

    // Use a select so the user can allow permanently for this session (not available for bash)
    let choice: string | undefined;
    try {
      const defaultOptions = defaultOptionsForTool(tool);

      const promptMsg = `Tool: ${tool}\n\nAllow execution?`;

      if (tool === "edit") {
        choice = await runEditApprovalLoop(ctx, event.input, promptMsg);
      } else if (tool === "write") {
        choice = await runWriteApprovalLoop(ctx, event.input, promptMsg);
      } else {
        choice = await ctx.ui.select(promptMsg, defaultOptions);
      }
    } catch (err) {
      // If UI threw for some reason, be conservative and block
      return {
        block: true,
        reason: `Blocked: ui.select failed (${String(err)})`,
      };
    }

    if (choice === "Yes, always this session") {
      if (supportsSessionAllow(tool)) {
        sessionAllow.add(tool);
      }
      return; // allow this call and future calls for session
    }

    if (choice !== "Yes") {
      // Ask optional reason for blocking to include in the returned reason
      let userReason: string | undefined;
      try {
        userReason = await ctx.ui.input(
          "Why was this denied? (optional)",
          "Reason for the LLM",
        );
      } catch {
        // ignore input errors
      }

      return {
        block: true,
        reason: userReason
          ? `Blocked by user. Reason: ${userReason}`
          : "Blocked by user",
      };
    }

    // If choice === "Yes" we simply allow the call by returning nothing
  });
}
