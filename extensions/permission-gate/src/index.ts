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
import {
  allowExecutionPrompt,
  APPROVAL_OPTION_VIEW_DIFF,
  APPROVAL_OPTION_YES,
  APPROVAL_OPTION_YES_SESSION,
  DENY_REASON_LABEL,
  DENY_REASON_PLACEHOLDER,
  DIFF_APPROVAL_OPTIONS,
  diffViewedPrompt,
  previewUnavailablePrompt,
  previewUnavailableWithSourcePrompt,
  unexpectedPreviewErrorPrompt,
} from "./prompt-messages.ts";

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
type InputFn = (label: string, placeholder?: string) => Promise<string | undefined>;
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
  return userReason ? `Blocked by user. Reason: ${userReason}` : "Blocked by user";
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


  async function runEditApprovalLoop(
    ctx: GateCtxWithSelectUI,
    input: unknown,
    initialPromptMsg: string,
  ) {
    const { path, edits } = extractEditInput(input);
    const editOptions = [...DIFF_APPROVAL_OPTIONS];

    let promptMsg = initialPromptMsg;
    while (true) {
      const choice = await ctx.ui.select(promptMsg, editOptions);
      if (choice !== APPROVAL_OPTION_VIEW_DIFF) return choice;

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
  ) {
    const { path, content } = extractWriteInput(input);
    const writeOptions = [...DIFF_APPROVAL_OPTIONS];

    let promptMsg = initialPromptMsg;
    while (true) {
      const choice = await ctx.ui.select(promptMsg, writeOptions);
      if (choice !== APPROVAL_OPTION_VIEW_DIFF) return choice;

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

    if (isAlwaysAllowedTool(tool)) return;
    if (shouldBypassPromptForSession(tool, sessionAllow)) return; // already allowed for this session

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
        choice = await runEditApprovalLoop(gateCtx, typedEvent.input, promptMsg);
      } else if (tool === "write") {
        choice = await runWriteApprovalLoop(gateCtx, typedEvent.input, promptMsg);
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
