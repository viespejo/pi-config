import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";

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
        const estimatedOverlayRows = Math.max(12, Math.floor(termRows * 0.88));
        const reservedChrome = 9; // top+bottom border + sticky header/footer rows
        return Math.max(8, Math.min(60, estimatedOverlayRows - reservedChrome));
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
