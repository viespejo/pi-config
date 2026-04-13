import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import nodePath from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { renderDiff } from "@mariozechner/pi-coding-agent";
import fs from "fs";
import * as Diff from "diff";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import {
  computeWriteDiffPreviewLocal,
  summarizeWriteForPrompt,
} from "./write-preview.ts";

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
  // Config: tools that should bypass the gate. Empty by default so all tools are gated.
  const ALWAYS_ALLOW_TOOLS = new Set<string>(["read", "ls", "grep", "find"]);

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

  async function showDiffInCustomDialog(
    ctx: any,
    path: string,
    rendered: string,
  ) {
    await ctx.ui.custom(
      (
        tui: any,
        theme: any,
        _keybindings: any,
        done: (result: void) => void,
      ) => {
        const lines = rendered.split("\n");
        let scrollOffset = 0;

        // Cache last frame: some TUI loops can call render() frequently even
        // when nothing changed. Returning a cached frame avoids re-truncating
        // and re-styling visible lines on every tick.
        let cachedWidth: number | undefined;
        let cachedViewportLines: number | undefined;
        let cachedScrollOffset: number | undefined;
        let cachedFrame: string[] | undefined;

        // Sticky header/footer with a bordered panel around scrollable diff content.
        const BASE_PAGE_STEP = 12;

        const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

        let added = 0;
        let removed = 0;
        let changeBlocks = 0;
        const blockOffsets: number[] = [];
        let inChangeRun = false;

        for (let i = 0; i < lines.length; i++) {
          const plain = stripAnsi(lines[i]!);
          const isHeader = plain.startsWith("+++") || plain.startsWith("---");
          const isAdded = plain.startsWith("+") && !isHeader;
          const isRemoved = plain.startsWith("-") && !isHeader;
          const isChange = isAdded || isRemoved;

          if (isAdded) added++;
          else if (isRemoved) removed++;

          if (isChange) {
            if (!inChangeRun) {
              changeBlocks++;
              blockOffsets.push(i);
              inChangeRun = true;
            }
          } else {
            inChangeRun = false;
          }
        }

        const navigationOffsets = blockOffsets;

        const padRightVisible = (s: string, target: number) => {
          const len = visibleWidth(s);
          return len >= target ? s : `${s}${" ".repeat(target - len)}`;
        };

        // Keep viewport height stable while the dialog is open. In some setups,
        // reading terminal rows per render can fluctuate and cause continuous
        // full re-renders.
        const fixedViewportLines = (() => {
          const termRows =
            typeof tui?.terminal?.rows === "number" ? tui.terminal.rows : 40;
          const estimatedOverlayRows = Math.max(
            12,
            Math.floor(termRows * 0.88),
          );
          const reservedChrome = 9; // top+bottom border + sticky header/footer rows
          return Math.max(
            8,
            Math.min(60, estimatedOverlayRows - reservedChrome),
          );
        })();

        const getViewportLines = () => fixedViewportLines;

        const maxOffset = () => Math.max(0, lines.length - getViewportLines());
        const setOffset = (next: number) => {
          const clamped = Math.max(0, Math.min(maxOffset(), next));
          if (clamped !== scrollOffset) {
            scrollOffset = clamped;
            tui.requestRender();
          }
        };

        const jumpToPreviousHunk = () => {
          for (let i = navigationOffsets.length - 1; i >= 0; i--) {
            if (navigationOffsets[i]! < scrollOffset) {
              setOffset(navigationOffsets[i]!);
              return;
            }
          }
          setOffset(0);
        };

        const jumpToNextHunk = () => {
          for (const offset of navigationOffsets) {
            if (offset > scrollOffset) {
              setOffset(offset);
              return;
            }
          }
          setOffset(maxOffset());
        };

        return {
          render(width: number) {
            const viewportLines = getViewportLines();
            if (
              cachedFrame &&
              cachedWidth === width &&
              cachedViewportLines === viewportLines &&
              cachedScrollOffset === scrollOffset
            ) {
              return cachedFrame;
            }

            const out: string[] = [];
            const innerW = Math.max(20, width - 2);

            const borderTop = (s: string) => theme.fg("borderAccent", s);
            const borderSide = (s: string) => theme.fg("borderMuted", s);
            const borderBottom = (s: string) => theme.fg("borderAccent", s);

            const row = (s: string) => {
              const clipped = truncateToWidth(s, innerW, "...", true);
              return `${borderSide("│")}${padRightVisible(clipped, innerW)}${borderSide("│")}`;
            };

            const start = lines.length === 0 ? 0 : scrollOffset + 1;
            const end = Math.min(lines.length, scrollOffset + viewportLines);
            const max = maxOffset();
            const percent =
              max === 0 ? 100 : Math.round((scrollOffset / max) * 100);

            const barSlots = Math.max(
              8,
              Math.min(24, Math.floor((innerW - 32) / 2)),
            );
            const filled = Math.max(
              0,
              Math.min(barSlots, Math.round((percent / 100) * barSlots)),
            );
            const bar = `[${"█".repeat(filled)}${"░".repeat(barSlots - filled)}]`;

            out.push(borderTop(`╭${"─".repeat(innerW)}╮`));
            out.push(row(theme.fg("accent", ` Diff preview: ${path}`)));
            out.push(
              row(
                ` ${theme.fg("success", `+${added}`)}  ${theme.fg("error", `-${removed}`)}  ${theme.fg("warning", `change blocks: ${changeBlocks}`)} `,
              ),
            );
            out.push(
              row(
                theme.fg(
                  "dim",
                  ` Lines ${start}-${end} / ${lines.length} (${percent}%) ${bar}`,
                ),
              ),
            );
            out.push(
              row(
                theme.fg(
                  "dim",
                  " ↑/↓ j/k • Ctrl+u/Ctrl+d • [/] change blocks • g/G • Enter/Esc/q",
                ),
              ),
            );
            out.push(row(""));

            const endIdx = Math.min(lines.length, scrollOffset + viewportLines);
            for (let i = scrollOffset; i < endIdx; i++) {
              out.push(row(lines[i]!));
            }
            for (let i = endIdx - scrollOffset; i < viewportLines; i++) {
              out.push(row(""));
            }

            out.push(row(""));
            out.push(
              row(
                theme.fg(
                  "dim",
                  " Close this viewer and then the permission selector will appear.",
                ),
              ),
            );
            out.push(borderBottom(`╰${"─".repeat(innerW)}╯`));

            cachedWidth = width;
            cachedViewportLines = viewportLines;
            cachedScrollOffset = scrollOffset;
            cachedFrame = out;
            return out;
          },
          handleInput(data: string) {
            if (
              matchesKey(data, Key.enter) ||
              matchesKey(data, Key.escape) ||
              data === "q" ||
              data === "Q"
            ) {
              done(undefined);
              return;
            }

            const pageStep = Math.max(
              BASE_PAGE_STEP,
              Math.floor(getViewportLines() / 2),
            );

            if (matchesKey(data, "up") || data === "k" || data === "K")
              return setOffset(scrollOffset - 1);
            if (matchesKey(data, "down") || data === "j" || data === "J")
              return setOffset(scrollOffset + 1);
            if (matchesKey(data, "ctrl+u"))
              return setOffset(scrollOffset - pageStep);
            if (matchesKey(data, "ctrl+d"))
              return setOffset(scrollOffset + pageStep);
            if (data === "[") return jumpToPreviousHunk();
            if (data === "]") return jumpToNextHunk();
            if (data === "g") return setOffset(0);
            if (data === "G") return setOffset(maxOffset());
          },
          invalidate() {
            cachedWidth = undefined;
            cachedViewportLines = undefined;
            cachedScrollOffset = undefined;
            cachedFrame = undefined;
          },
        };
      },
      {}, // non-overlay mode: avoids expensive compositing redraw loops
    );
  }

  // Helper: summarize edits into a metadata-only preview string. This avoids
  // reading file contents when the detailed diff helper is not available.
  function summarizeEditsForPrompt(edits: any, filePath?: string) {
    if (!Array.isArray(edits)) return `Edits: (unknown format)`;

    let inserts = 0,
      deletes = 0,
      replaces = 0;
    let totalOld = 0,
      totalNew = 0;
    const examples: string[] = [];

    for (let i = 0; i < edits.length; i++) {
      const e = edits[i] ?? {};
      const newText =
        typeof e.newText === "string"
          ? e.newText
          : typeof e.text === "string"
            ? e.text
            : "";
      const oldText =
        typeof e.oldText === "string"
          ? e.oldText
          : typeof e.original === "string"
            ? e.original
            : "";
      const hasOld = oldText.length > 0;
      const hasNew = newText.length > 0;

      if (hasOld && hasNew) replaces++;
      else if (!hasOld && hasNew) inserts++;
      else if (hasOld && !hasNew) deletes++;
      else replaces++; // fallback

      totalOld += oldText.length;
      totalNew += newText.length;

      if (examples.length < 3) {
        const rangeInfo =
          e.start !== undefined || e.end !== undefined
            ? `range: ${String(e.start ?? "?")}-${String(e.end ?? "?")}`
            : e.range
              ? `range: ${JSON.stringify(e.range)}`
              : "";
        examples.push(
          `- Edit ${i + 1}: type=${hasOld ? (hasNew ? "replace" : "delete") : "insert"}, oldChars=${oldText.length}, newChars=${newText.length}${rangeInfo ? `, ${rangeInfo}` : ""}`,
        );
      }
    }

    const summaryLines = [
      filePath ? `Path: ${String(filePath)}` : undefined,
      `Total edits: ${edits.length} (inserts=${inserts}, deletes=${deletes}, replaces=${replaces})`,
      `Total old chars: ${totalOld}, total new chars: ${totalNew}`,
      examples.length ? `Examples:\n${examples.join("\n")}` : undefined,
      `Note: detailed preview unavailable. Showing metadata only.`,
    ].filter(Boolean) as string[];

    return summaryLines.join("\n");
  }

  pi.on("tool_call", async (event, ctx) => {
    const tool = event.toolName ?? "tool";

    if (ALWAYS_ALLOW_TOOLS.has(tool)) return;
    if (tool !== "bash" && sessionAllow.has(tool)) return; // already allowed for this session

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
      const defaultOptions =
        tool === "bash"
          ? ["Yes", "No"]
          : ["Yes", "Yes, always this session", "No"];

      let promptMsg = `Tool: ${tool}\n\nAllow execution?`;

      if (tool === "edit") {
        const inp = event.input as any;
        const path =
          typeof inp?.path === "string"
            ? inp.path
            : typeof inp?.file_path === "string"
              ? inp.file_path
              : undefined;
        const edits = Array.isArray(inp?.edits) ? inp.edits : undefined;

        const editOptions = [
          "Yes",
          "View diff",
          "Yes, always this session",
          "No",
        ];

        while (true) {
          choice = await ctx.ui.select(promptMsg, editOptions);
          if (choice !== "View diff") break;

          if (!path || !edits) {
            promptMsg = `Tool: ${tool}\n\nPreview unavailable: missing path/edits input.\n\nAllow execution?`;
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
              promptMsg = `Tool: ${tool}\n\nDiff viewed (${engine}). Allow execution?`;
            } else if ("error" in diffRes) {
              const errMsg = String(diffRes.error ?? "Preview unavailable");
              const meta = summarizeEditsForPrompt(edits, path);
              promptMsg = `Tool: ${tool}\n\nPreview unavailable (${engine}): ${errMsg}\n\n${meta}\n\nAllow execution?`;
            }
          } catch {
            promptMsg = `Tool: ${tool}\n\nPreview unavailable due to an unexpected error.\n\nAllow execution?`;
          }
        }
      } else if (tool === "write") {
        const inp = event.input as any;
        const path =
          typeof inp?.path === "string"
            ? inp.path
            : typeof inp?.file_path === "string"
              ? inp.file_path
              : undefined;
        const content =
          typeof inp?.content === "string"
            ? inp.content
            : typeof inp?.text === "string"
              ? inp.text
              : undefined;

        const writeOptions = [
          "Yes",
          "View diff",
          "Yes, always this session",
          "No",
        ];

        while (true) {
          choice = await ctx.ui.select(promptMsg, writeOptions);
          if (choice !== "View diff") break;

          if (!path || typeof content !== "string") {
            const reason = !path
              ? "missing path input"
              : "missing content input";
            const meta = summarizeWriteForPrompt({ path, content });
            promptMsg = `Tool: ${tool}\n\nPreview unavailable: ${reason}.\n\n${meta}\n\nAllow execution?`;
            continue;
          }

          try {
            const cwd = ctx.cwd ?? process.cwd();
            const diffRes = await computeWriteDiffPreviewLocal(path, content, cwd);

            if (!("error" in diffRes) && diffRes.diff) {
              const rendered = renderDiff(diffRes.diff, { filePath: path });
              await showDiffInCustomDialog(ctx, path, rendered);
              const mode = diffRes.existedBeforeWrite ? "overwrite" : "create";
              promptMsg = `Tool: ${tool}\n\nDiff viewed (write:${mode}). Allow execution?`;
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
              promptMsg = `Tool: ${tool}\n\nPreview unavailable (write:local): ${errMsg}\n\n${meta}\n\nAllow execution?`;
            }
          } catch {
            promptMsg = `Tool: ${tool}\n\nPreview unavailable due to an unexpected error.\n\nAllow execution?`;
          }
        }
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
      if (tool !== "bash") {
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
