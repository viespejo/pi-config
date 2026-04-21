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
import { summarizeEditsForPrompt } from "./edit-preview.ts";
import { extractEditInput, extractWriteInput } from "./tool-input.ts";
import {
  APPROVAL_OPTION_REVIEW_NVIM,
  APPROVAL_OPTION_VIEW_DIFF,
  DIFF_APPROVAL_OPTIONS,
  REVIEW_OPTION_APPLY,
  REVIEW_OPTION_BACK,
  diffViewedPrompt,
  neovimReviewChangedPrompt,
  neovimUnavailablePrompt,
  previewUnavailablePrompt,
  previewUnavailableWithSourcePrompt,
  unexpectedPreviewErrorPrompt,
  DENY_REASON_LABEL,
  DENY_REASON_PLACEHOLDER,
} from "./prompt-messages.ts";
import { reviewInNeovim, type NeovimReviewAdapters } from "./neovim-review.ts";

export type SelectFn = (
  prompt: string,
  options: string[],
  opts?: unknown,
) => Promise<string | undefined>;
export type InputFn = (
  label: string,
  placeholder?: string,
) => Promise<string | undefined>;
export type NotifyFn = (
  message: string,
  level?: "info" | "warning" | "error",
) => void;

export type GateUI = {
  select?: SelectFn;
  input?: InputFn;
  notify?: NotifyFn;
};

export type GateCtx = {
  hasUI?: boolean;
  ui?: GateUI;
  cwd?: string;
  neovimReviewAdapters?: NeovimReviewAdapters;
};

export type ApprovalLoopResult =
  | { type: "choice"; choice: string | undefined }
  | {
      type: "apply-reviewed";
      filePath: string;
      proposedContent: string;
      reviewedContent: string;
    };

export type GateCtxWithSelectUI = GateCtx & {
  hasUI: true;
  ui: GateUI & { select: SelectFn };
};

export function hasSelectUI(ctx: GateCtx): ctx is GateCtxWithSelectUI {
  return Boolean(ctx.hasUI && ctx.ui && typeof ctx.ui.select === "function");
}

export async function askOptionalDenyReason(ctx: GateCtxWithSelectUI) {
  try {
    if (typeof ctx.ui.input === "function") {
      return await ctx.ui.input(DENY_REASON_LABEL, DENY_REASON_PLACEHOLDER);
    }
  } catch {
    // ignore input errors
  }

  return undefined;
}

function hasAiComments(content: string) {
  return /\bai:/.test(content);
}

export async function applyReviewedVersion(params: {
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
      throw new Error(`edits[${edit.idx}].oldText must be unique in ${filePath}.`);
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

export async function runEditApprovalLoop(
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
        const proposedContent = await buildProposedEditContent(cwd, path, edits);
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

    if (choice !== APPROVAL_OPTION_VIEW_DIFF) return { type: "choice", choice };

    if (!path || !edits) {
      promptMsg = previewUnavailablePrompt("edit", "missing path/edits input.");
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

export async function runWriteApprovalLoop(
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

      const reviewChoice = await ctx.ui.select(neovimReviewChangedPrompt("write"), [
        REVIEW_OPTION_APPLY,
        REVIEW_OPTION_BACK,
      ]);

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
    if (choice !== APPROVAL_OPTION_VIEW_DIFF) return { type: "choice", choice };

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
            "existedBeforeWrite" in diffRes ? diffRes.existedBeforeWrite : undefined,
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
