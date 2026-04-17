import fs from "fs";
import nodePath from "path";
import * as Diff from "diff";

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

export async function computeEditsDiffLocalFallback(
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
