import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

type ViewMode = "wrap" | "no-wrap";

export async function showDiffInCustomDialog(
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
      let mode: ViewMode = "wrap";
      let scrollOffset = 0;
      let horizontalOffset = 0;
      let pendingG = false;

      // Cache last frame: some TUI loops can call render() frequently even
      // when nothing changed. Returning a cached frame avoids re-truncating
      // and re-styling visible lines on every tick.
      let cachedWidth: number | undefined;
      let cachedViewportLines: number | undefined;
      let cachedScrollOffset: number | undefined;
      let cachedMode: ViewMode | undefined;
      let cachedHorizontalOffset: number | undefined;
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

      const padRightVisible = (s: string, target: number) => {
        const safe = truncateToWidth(s, target);
        const len = visibleWidth(safe);
        return len >= target ? safe : `${safe}${" ".repeat(target - len)}`;
      };

      // Keep viewport height stable while the dialog is open. In some setups,
      // reading terminal rows per render can fluctuate and cause continuous
      // full re-renders.
      const fixedViewportLines = (() => {
        const termRows =
          typeof tui?.terminal?.rows === "number" ? tui.terminal.rows : 40;
        const estimatedOverlayRows = Math.max(12, Math.floor(termRows * 0.88));
        const reservedChrome = 9; // top+bottom border + sticky header/footer rows
        return Math.max(8, Math.min(60, estimatedOverlayRows - reservedChrome));
      })();

      const getViewportLines = () => fixedViewportLines;

      const wrapAnsiByWidth = (input: string, width: number): string[] => {
        if (width <= 0) return [""];

        const out: string[] = [];
        let activeAnsi = "";
        let chunk = "";
        let chunkWidth = 0;
        let i = 0;

        while (i < input.length) {
          if (input[i] === "\u001b") {
            const match = input.slice(i).match(/^\x1b\[[0-9;]*m/);
            if (match?.[0]) {
              const seq = match[0];
              chunk += seq;
              if (seq === "\u001b[0m") activeAnsi = "";
              else activeAnsi += seq;
              i += seq.length;
              continue;
            }
          }

          chunk += input[i]!;
          chunkWidth += 1;
          i += 1;

          if (chunkWidth >= width) {
            out.push(chunk.endsWith("\u001b[0m") ? chunk : `${chunk}\u001b[0m`);
            chunk = activeAnsi;
            chunkWidth = 0;
          }
        }

        if (chunkWidth > 0 || out.length === 0) {
          out.push(chunk.endsWith("\u001b[0m") ? chunk : `${chunk}\u001b[0m`);
        }

        return out;
      };

      const sliceAnsiByColumns = (input: string, start: number, width: number) => {
        if (width <= 0) return "";

        let i = 0;
        let visible = 0;
        let activeAnsi = "";
        let out = "";

        while (i < input.length) {
          if (input[i] === "\u001b") {
            const match = input.slice(i).match(/^\x1b\[[0-9;]*m/);
            if (match?.[0]) {
              const seq = match[0];
              if (seq === "\u001b[0m") activeAnsi = "";
              else activeAnsi += seq;
              if (visible >= start && visible < start + width) out += seq;
              i += seq.length;
              continue;
            }
          }

          if (visible >= start && visible < start + width) {
            if (out.length === 0 && activeAnsi) out += activeAnsi;
            out += input[i]!;
          }
          visible += 1;
          i += 1;
          if (visible >= start + width) break;
        }

        return out.endsWith("\u001b[0m") || out.length === 0 ? out : `${out}\u001b[0m`;
      };

      const buildViewportModel = (innerW: number) => {
        if (mode === "no-wrap") {
          return {
            rows: lines,
            hunkOffsets: blockOffsets,
          };
        }

        const rows: string[] = [];
        const logicalToVisual = new Map<number, number>();

        for (let i = 0; i < lines.length; i++) {
          logicalToVisual.set(i, rows.length);
          rows.push(...wrapAnsiByWidth(lines[i]!, innerW));
        }

        return {
          rows,
          hunkOffsets: blockOffsets.map((idx) => logicalToVisual.get(idx) ?? 0),
        };
      };

      const maxOffset = (rowCount: number) =>
        Math.max(0, rowCount - getViewportLines());

      const setOffset = (next: number, rowCount: number) => {
        const clamped = Math.max(0, Math.min(maxOffset(rowCount), next));
        if (clamped !== scrollOffset) {
          scrollOffset = clamped;
          tui.requestRender();
        }
      };

      const jumpToPreviousHunk = (offsets: number[], rowCount: number) => {
        if (mode === "no-wrap") horizontalOffset = 0;
        for (let i = offsets.length - 1; i >= 0; i--) {
          if (offsets[i]! < scrollOffset) {
            setOffset(offsets[i]!, rowCount);
            return;
          }
        }
        setOffset(0, rowCount);
      };

      const jumpToNextHunk = (offsets: number[], rowCount: number) => {
        if (mode === "no-wrap") horizontalOffset = 0;
        for (const offset of offsets) {
          if (offset > scrollOffset) {
            setOffset(offset, rowCount);
            return;
          }
        }
        setOffset(maxOffset(rowCount), rowCount);
      };

      return {
        render(width: number) {
          const viewportLines = getViewportLines();
          if (
            cachedFrame &&
            cachedWidth === width &&
            cachedViewportLines === viewportLines &&
            cachedScrollOffset === scrollOffset &&
            cachedMode === mode &&
            cachedHorizontalOffset === horizontalOffset
          ) {
            return cachedFrame;
          }

          const out: string[] = [];
          const innerW = Math.max(20, width - 2);

          const model = buildViewportModel(innerW);
          const rows = model.rows;
          const clamped = Math.max(0, Math.min(scrollOffset, maxOffset(rows.length)));
          if (clamped !== scrollOffset) scrollOffset = clamped;

          const borderTop = (s: string) => theme.fg("borderAccent", s);
          const borderSide = (s: string) => theme.fg("borderMuted", s);
          const borderBottom = (s: string) => theme.fg("borderAccent", s);

          const row = (s: string) => {
            const clipped =
              mode === "wrap"
                ? s
                : sliceAnsiByColumns(s, horizontalOffset, innerW);
            return `${borderSide("│")}${padRightVisible(clipped, innerW)}${borderSide("│")}`;
          };

          const start = rows.length === 0 ? 0 : scrollOffset + 1;
          const end = Math.min(rows.length, scrollOffset + viewportLines);
          const max = maxOffset(rows.length);
          const percent = max === 0 ? 100 : Math.round((scrollOffset / max) * 100);

          const barSlots = Math.max(8, Math.min(24, Math.floor((innerW - 32) / 2)));
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
          out.push(row(theme.fg("dim", ` Mode: ${mode === "wrap" ? "Wrap" : "No-wrap"}`)));
          out.push(
            row(
              theme.fg(
                "dim",
                ` Lines ${start}-${end} / ${rows.length} (${percent}%) ${bar}`,
              ),
            ),
          );
          out.push(
            row(
              theme.fg(
                "dim",
                " ↑/↓ j/k • gg/G • Ctrl+u/Ctrl+d • [/] change blocks • w • ←/→ h/l ^/0/$ (No-wrap) • Enter/Esc/q",
              ),
            ),
          );
          out.push(row(""));

          const endIdx = Math.min(rows.length, scrollOffset + viewportLines);
          for (let i = scrollOffset; i < endIdx; i++) {
            out.push(row(rows[i]!));
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
          cachedMode = mode;
          cachedHorizontalOffset = horizontalOffset;
          cachedFrame = out;
          return out;
        },
        handleInput(data: string) {
          const terminalWidth =
            typeof tui?.terminal?.columns === "number" ? tui.terminal.columns : 80;
          const innerW = Math.max(20, terminalWidth - 2);
          const model = buildViewportModel(innerW);
          const rows = model.rows;

          if (
            matchesKey(data, Key.enter) ||
            matchesKey(data, Key.escape) ||
            data === "q" ||
            data === "Q"
          ) {
            done(undefined);
            return;
          }

          if (data === "w" || data === "W") {
            mode = mode === "wrap" ? "no-wrap" : "wrap";
            scrollOffset = 0;
            horizontalOffset = 0;
            pendingG = false;
            this.invalidate();
            tui.requestRender();
            return;
          }

          const pageStep = Math.max(
            BASE_PAGE_STEP,
            Math.floor(getViewportLines() / 2),
          );

          if (matchesKey(data, "up") || data === "k" || data === "K") {
            pendingG = false;
            return setOffset(scrollOffset - 1, rows.length);
          }
          if (matchesKey(data, "down") || data === "j" || data === "J") {
            pendingG = false;
            return setOffset(scrollOffset + 1, rows.length);
          }
          if (matchesKey(data, "ctrl+u")) {
            pendingG = false;
            return setOffset(scrollOffset - pageStep, rows.length);
          }
          if (matchesKey(data, "ctrl+d")) {
            pendingG = false;
            return setOffset(scrollOffset + pageStep, rows.length);
          }
          if (data === "[") {
            pendingG = false;
            return jumpToPreviousHunk(model.hunkOffsets, rows.length);
          }
          if (data === "]") {
            pendingG = false;
            return jumpToNextHunk(model.hunkOffsets, rows.length);
          }
          if (data === "g") {
            if (pendingG) {
              pendingG = false;
              return setOffset(0, rows.length);
            }
            pendingG = true;
            return;
          }
          if (data === "G") {
            pendingG = false;
            return setOffset(maxOffset(rows.length), rows.length);
          }

          if (mode === "no-wrap") {
            const currentLine = lines[Math.max(0, Math.min(lines.length - 1, scrollOffset))] ?? "";
            const lineWidth = visibleWidth(currentLine);
            const toLineStart =
              data === "^" || data === "0" || matchesKey(data, "home");
            const toLineEnd = data === "$" || matchesKey(data, "end");

            if (data === "h" || matchesKey(data, "left")) {
              pendingG = false;
              horizontalOffset = Math.max(0, horizontalOffset - 1);
              this.invalidate();
              tui.requestRender();
              return;
            }
            if (data === "l" || matchesKey(data, "right")) {
              pendingG = false;
              horizontalOffset = Math.max(0, Math.min(lineWidth, horizontalOffset + 1));
              this.invalidate();
              tui.requestRender();
              return;
            }
            if (toLineStart) {
              pendingG = false;
              horizontalOffset = 0;
              this.invalidate();
              tui.requestRender();
              return;
            }
            if (toLineEnd) {
              pendingG = false;
              horizontalOffset = Math.max(0, lineWidth - innerW);
              if (lineWidth > 0 && horizontalOffset === 0) {
                horizontalOffset = Math.max(0, lineWidth - 1);
              }
              this.invalidate();
              tui.requestRender();
              return;
            }
          } else if (
            data === "h" ||
            data === "l" ||
            data === "^" ||
            data === "0" ||
            data === "$" ||
            matchesKey(data, "left") ||
            matchesKey(data, "right") ||
            matchesKey(data, "home") ||
            matchesKey(data, "end")
          ) {
            pendingG = false;
            return;
          }

          pendingG = false;
        },
        invalidate() {
          cachedWidth = undefined;
          cachedViewportLines = undefined;
          cachedScrollOffset = undefined;
          cachedMode = undefined;
          cachedHorizontalOffset = undefined;
          cachedFrame = undefined;
        },
      };
    },
    {}, // non-overlay mode: avoids expensive compositing redraw loops
  );
}
