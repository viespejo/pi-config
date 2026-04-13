import fs from "fs";
import nodePath from "path";
import * as Diff from "diff";

function normalizeToLF(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripBom(text: string) {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function generateSingleSidedDiffStringLocal(
  content: string,
  kind: "added" | "removed",
) {
  const rows = content.split("\n");
  if (rows[rows.length - 1] === "") rows.pop();

  if (rows.length === 0) {
    return { diff: "", firstChangedLine: 1 };
  }

  const prefix = kind === "added" ? "+" : "-";
  const lineNumWidth = String(rows.length).length;
  const out = rows.map(
    (line, i) => `${prefix}${String(i + 1).padStart(lineNumWidth, " ")} ${line}`,
  );

  return { diff: out.join("\n"), firstChangedLine: 1 };
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

function generateDiffStringOptimized(
  oldContent: string,
  newContent: string,
  contextLines = 4,
) {
  if (!oldContent.length && newContent.length) {
    return generateSingleSidedDiffStringLocal(newContent, "added");
  }
  if (oldContent.length && !newContent.length) {
    return generateSingleSidedDiffStringLocal(oldContent, "removed");
  }
  return generateDiffStringLocal(oldContent, newContent, contextLines);
}

export type WritePreviewResult =
  | {
      diff: string;
      firstChangedLine?: number;
      existedBeforeWrite: boolean;
      oldChars: number;
      newChars: number;
    }
  | {
      error: string;
      existedBeforeWrite?: boolean;
      oldChars?: number;
      newChars?: number;
    };

export async function computeWriteDiffPreviewLocal(
  path: string,
  content: string,
  cwd: string,
): Promise<WritePreviewResult> {
  try {
    if (!path || typeof path !== "string") {
      return { error: "Missing path" };
    }
    if (typeof content !== "string") {
      return { error: "Missing write content" };
    }

    const absolutePath = nodePath.isAbsolute(path)
      ? path
      : nodePath.resolve(cwd, path);

    let previousRaw = "";
    let existedBeforeWrite = true;
    try {
      previousRaw = await fs.promises.readFile(absolutePath, "utf-8");
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        existedBeforeWrite = false;
        previousRaw = "";
      } else {
        return {
          error: `Could not read existing file: ${String(err?.message ?? err)}`,
        };
      }
    }

    const oldContent = normalizeToLF(stripBom(previousRaw));
    const newContent = normalizeToLF(stripBom(content));

    if (oldContent === newContent) {
      return {
        error: `No changes made to ${path}.`,
        existedBeforeWrite,
        oldChars: oldContent.length,
        newChars: newContent.length,
      };
    }

    const diffRes = generateDiffStringOptimized(oldContent, newContent);
    return {
      ...diffRes,
      existedBeforeWrite,
      oldChars: oldContent.length,
      newChars: newContent.length,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function summarizeWriteForPrompt(params: {
  path?: string;
  content?: string;
  existedBeforeWrite?: boolean;
  oldChars?: number;
  newChars?: number;
  extraNote?: string;
}) {
  const { path, content, existedBeforeWrite, oldChars, newChars, extraNote } =
    params;

  const targetState =
    existedBeforeWrite === undefined
      ? "unknown"
      : existedBeforeWrite
        ? "overwrite existing file"
        : "create new file";

  const nextChars =
    typeof newChars === "number"
      ? newChars
      : typeof content === "string"
        ? normalizeToLF(stripBom(content)).length
        : undefined;

  const summaryLines = [
    path ? `Path: ${String(path)}` : undefined,
    `Write mode: ${targetState}`,
    typeof oldChars === "number" ? `Current file chars: ${oldChars}` : undefined,
    typeof nextChars === "number" ? `New content chars: ${nextChars}` : undefined,
    extraNote,
    `Note: detailed preview unavailable. Showing metadata only.`,
  ].filter(Boolean) as string[];

  return summaryLines.join("\n");
}
