import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import nodePath from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { renderDiff } from "@mariozechner/pi-coding-agent";
import fs from "fs";
import * as Diff from "diff";
import {
  computeWriteDiffPreviewLocal,
  summarizeWriteForPrompt,
} from "./write-preview.ts";
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

// Module-scoped loader for computeEditsDiff. We attempt to load the internal
// utility once per process and cache the result. This prevents repeated
// filesystem searches on every tool call and avoids redundant concurrent
// imports by reusing a single Promise.
type ComputeEditsDiffFn = (p: string, e: any[], cwd: string) => Promise<any>;

type DiffEngineSource =
  | "internal:fs-search"
  | "internal:global-node-modules"
  | "local:fallback"
  | "none";

let computeEditsDiffLoadPromise: Promise<
  ComputeEditsDiffFn | undefined
> | null = null;
let computeEditsDiffSource: DiffEngineSource = "none";

function loadComputeEditsDiffOnce() {
  if (computeEditsDiffLoadPromise) return computeEditsDiffLoadPromise;

  computeEditsDiffLoadPromise = (async () => {
    const pkgName = "@mariozechner/pi-coding-agent";

    const tryLoadFromAbsolutePath = async (
      editDiffPath: string,
      source: DiffEngineSource,
    ) => {
      if (!fs.existsSync(editDiffPath)) return undefined;
      const mod = await import(pathToFileURL(editDiffPath).href);
      const fn = mod?.computeEditsDiff ?? mod?.default?.computeEditsDiff;
      if (typeof fn !== "function") return undefined;
      computeEditsDiffSource = source;
      return fn as ComputeEditsDiffFn;
    };

    // 1) Local/project search: walk upwards from cwd and extension dir.
    try {
      const extensionDir = nodePath.dirname(fileURLToPath(import.meta.url));
      const tryDirs = [process.cwd(), extensionDir];
      for (const start of tryDirs) {
        let dir = nodePath.resolve(start);
        while (true) {
          const editDiffPath = nodePath.join(
            dir,
            "node_modules",
            pkgName,
            "dist/core/tools/edit-diff.js",
          );
          const fn = await tryLoadFromAbsolutePath(
            editDiffPath,
            "internal:fs-search",
          );
          if (fn) return fn;

          const parent = nodePath.dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
      }
    } catch {
      // ignore and continue
    }

    // 2) Global npm-like locations (covers global pi installations).
    try {
      const globalCandidates = [
        nodePath.resolve(process.execPath, "..", "..", "lib", "node_modules"),
        nodePath.resolve(process.execPath, "..", "..", "node_modules"),
        "/usr/local/lib/node_modules",
        "/opt/homebrew/lib/node_modules",
      ];
      for (const globalRoot of globalCandidates) {
        const editDiffPath = nodePath.join(
          globalRoot,
          pkgName,
          "dist/core/tools/edit-diff.js",
        );
        const fn = await tryLoadFromAbsolutePath(
          editDiffPath,
          "internal:global-node-modules",
        );
        if (fn) return fn;
      }
    } catch {
      // ignore and fall back to local implementation
    }

    computeEditsDiffSource = "local:fallback";
    return undefined;
  })();

  return computeEditsDiffLoadPromise;
}

function normalizeToLF(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripBom(text: string) {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function generateDiffStringLocal(
  oldContent: string,
  newContent: string,
  contextLines = 4,
) {
  const parts = Diff.diffLines(oldContent, newContent);
  const output: string[] = [];

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const maxLineNum = Math.max(oldLines.length, newLines.length);
  const lineNumWidth = String(maxLineNum).length;

  let oldLineNum = 1;
  let newLineNum = 1;
  let lastWasChange = false;
  let firstChangedLine: number | undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const raw = part.value.split("\n");
    if (raw[raw.length - 1] === "") raw.pop();

    if (part.added || part.removed) {
      if (firstChangedLine === undefined) firstChangedLine = newLineNum;

      for (const line of raw) {
        if (part.added) {
          const lineNum = String(newLineNum).padStart(lineNumWidth, " ");
          output.push(`+${lineNum} ${line}`);
          newLineNum++;
        } else {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(`-${lineNum} ${line}`);
          oldLineNum++;
        }
      }
      lastWasChange = true;
    } else {
      const nextPartIsChange =
        i < parts.length - 1 && (parts[i + 1]!.added || parts[i + 1]!.removed);
      const hasLeadingChange = lastWasChange;
      const hasTrailingChange = nextPartIsChange;

      if (hasLeadingChange && hasTrailingChange) {
        if (raw.length <= contextLines * 2) {
          for (const line of raw) {
            const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${lineNum} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
        } else {
          const leadingLines = raw.slice(0, contextLines);
          const trailingLines = raw.slice(raw.length - contextLines);
          const skippedLines =
            raw.length - leadingLines.length - trailingLines.length;

          for (const line of leadingLines) {
            const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${lineNum} ${line}`);
            oldLineNum++;
            newLineNum++;
          }

          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          oldLineNum += skippedLines;
          newLineNum += skippedLines;

          for (const line of trailingLines) {
            const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
            output.push(` ${lineNum} ${line}`);
            oldLineNum++;
            newLineNum++;
          }
        }
      } else if (hasLeadingChange) {
        const shownLines = raw.slice(0, contextLines);
        const skippedLines = raw.length - shownLines.length;

        for (const line of shownLines) {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(` ${lineNum} ${line}`);
          oldLineNum++;
          newLineNum++;
        }

        if (skippedLines > 0) {
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          oldLineNum += skippedLines;
          newLineNum += skippedLines;
        }
      } else if (hasTrailingChange) {
        const skippedLines = Math.max(0, raw.length - contextLines);
        if (skippedLines > 0) {
          output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
          oldLineNum += skippedLines;
          newLineNum += skippedLines;
        }

        for (const line of raw.slice(skippedLines)) {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
          output.push(` ${lineNum} ${line}`);
          oldLineNum++;
          newLineNum++;
        }
      } else {
        oldLineNum += raw.length;
        newLineNum += raw.length;
      }

      lastWasChange = false;
    }
  }

  return { diff: output.join("\n"), firstChangedLine };
}

async function computeEditsDiffLocalFallback(
  path: string,
  edits: any[],
  cwd: string,
): Promise<{ diff: string; firstChangedLine?: number } | { error: string }> {
  try {
    if (!Array.isArray(edits) || edits.length === 0) {
      return { error: "No edits provided" };
    }

    const absolutePath = nodePath.isAbsolute(path)
      ? path
      : nodePath.resolve(cwd, path);

    try {
      await fs.promises.access(absolutePath, fs.constants.R_OK);
    } catch {
      return { error: `File not found: ${path}` };
    }

    const rawContent = await fs.promises.readFile(absolutePath, "utf-8");
    const base = normalizeToLF(stripBom(rawContent));

    const normalizedEdits = edits.map((e, i) => {
      const oldText =
        typeof e?.oldText === "string" ? normalizeToLF(e.oldText) : "";
      const newText =
        typeof e?.newText === "string" ? normalizeToLF(e.newText) : "";
      if (!oldText.length) {
        throw new Error(`edits[${i}].oldText must not be empty in ${path}.`);
      }
      return { oldText, newText, editIndex: i };
    });

    const matches = normalizedEdits.map((e) => {
      const first = base.indexOf(e.oldText);
      if (first === -1) {
        throw new Error(
          `Could not find edits[${e.editIndex}] in ${path}. oldText must match exactly.`,
        );
      }
      const second = base.indexOf(e.oldText, first + 1);
      if (second !== -1) {
        throw new Error(
          `Found multiple occurrences of edits[${e.editIndex}] in ${path}. oldText must be unique.`,
        );
      }
      return {
        ...e,
        start: first,
        end: first + e.oldText.length,
      };
    });

    const byOffset = [...matches].sort((a, b) => a.start - b.start);
    for (let i = 1; i < byOffset.length; i++) {
      if (byOffset[i - 1]!.end > byOffset[i]!.start) {
        throw new Error(
          `edits[${byOffset[i - 1]!.editIndex}] and edits[${byOffset[i]!.editIndex}] overlap in ${path}.`,
        );
      }
    }

    let newContent = base;
    for (let i = byOffset.length - 1; i >= 0; i--) {
      const m = byOffset[i]!;
      newContent =
        newContent.slice(0, m.start) + m.newText + newContent.slice(m.end);
    }

    if (newContent === base) {
      return { error: `No changes made to ${path}.` };
    }

    return generateDiffStringLocal(base, newContent);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
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
    const fn = await loadComputeEditsDiffOnce();
    if (!fn && !internalDiffFallbackNotified) {
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
        const computeEditsDiffFn = await loadComputeEditsDiffOnce();
        const cwd = ctx.cwd ?? process.cwd();
        const engine = computeEditsDiffFn
          ? computeEditsDiffSource
          : "local:fallback";
        const diffRes = computeEditsDiffFn
          ? await computeEditsDiffFn(path, edits, cwd)
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
