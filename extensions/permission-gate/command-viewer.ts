import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

type BashExplanationDetails = {
  summary: string;
  risks: string[];
  impact: string;
  recommendation: "safe-ish" | "caution" | "dangerous";
  flags?: string[];
  commandWasTruncated?: boolean;
};

type BashDetails = {
  command: string;
  policyReason?: string;
  highRiskReasons?: string[];
  explanation?: BashExplanationDetails;
};

function buildDetailsText(details: BashDetails) {
  const sections: string[] = [];

  sections.push(["Tool: bash", "", "Command:", details.command].join("\n"));

  if (details.policyReason) {
    sections.push(["Policy reason:", details.policyReason].join("\n"));
  }

  if (details.highRiskReasons && details.highRiskReasons.length > 0) {
    sections.push(
      [
        "High-risk reasons:",
        ...details.highRiskReasons.map((reason) => `- ${reason}`),
      ].join("\n"),
    );
  }

  if (details.explanation) {
    const explanationLines = [
      "Explanation:",
      `summary: ${details.explanation.summary}`,
      `impact: ${details.explanation.impact}`,
      `recommendation: ${details.explanation.recommendation}`,
      `risks: ${details.explanation.risks.length > 0 ? details.explanation.risks.join("  ·  ") : "unknown"}`,
    ];

    if (details.explanation.flags && details.explanation.flags.length > 0) {
      explanationLines.push(`flags: ${details.explanation.flags.join(", ")}`);
    }
    if (details.explanation.commandWasTruncated) {
      explanationLines.push("note: truncated command input was used for AI explanation.");
    }

    sections.push(explanationLines.join("\n"));
  }

  return sections.join("\n\n");
}

export async function showBashDetailsInCustomDialog(
  ctx: any,
  details: BashDetails,
  title = "Bash approval details",
) {
  const content = buildDetailsText(details);

  await ctx.ui.custom(
    (
      tui: any,
      theme: any,
      _keybindings: any,
      done: (result: void) => void,
    ) => {
      let scrollOffset = 0;
      let pendingG = false;
      let cachedWidth: number | undefined;
      let cachedScrollOffset: number | undefined;
      let cachedFrame: string[] | undefined;

      const fixedViewportLines = (() => {
        const termRows =
          typeof tui?.terminal?.rows === "number" ? tui.terminal.rows : 40;
        const estimatedRows = Math.max(12, Math.floor(termRows * 0.88));
        const reservedChrome = 7;
        return Math.max(8, Math.min(60, estimatedRows - reservedChrome));
      })();

      const padRightVisible = (s: string, target: number) => {
        const safe = truncateToWidth(s, target);
        const len = visibleWidth(safe);
        return len >= target ? safe : `${safe}${" ".repeat(target - len)}`;
      };

      const buildRows = (innerW: number) =>
        content
          .split("\n")
          .flatMap((line) => wrapTextWithAnsi(line, innerW));

      const maxOffset = (rowCount: number) =>
        Math.max(0, rowCount - fixedViewportLines);

      const setOffset = (next: number, rowCount: number) => {
        const clamped = Math.max(0, Math.min(maxOffset(rowCount), next));
        if (clamped !== scrollOffset) {
          scrollOffset = clamped;
          tui.requestRender();
        }
      };

      return {
        render(width: number) {
          if (
            cachedFrame &&
            cachedWidth === width &&
            cachedScrollOffset === scrollOffset
          ) {
            return cachedFrame;
          }

          const out: string[] = [];
          const innerW = Math.max(20, width - 2);
          const rows = buildRows(innerW);
          const clamped = Math.max(0, Math.min(scrollOffset, maxOffset(rows.length)));
          if (clamped !== scrollOffset) scrollOffset = clamped;

          const borderTop = (s: string) => theme.fg("borderAccent", s);
          const borderSide = (s: string) => theme.fg("borderMuted", s);
          const borderBottom = (s: string) => theme.fg("borderAccent", s);
          const row = (s: string) =>
            `${borderSide("│")}${padRightVisible(s, innerW)}${borderSide("│")}`;

          const start = rows.length === 0 ? 0 : scrollOffset + 1;
          const end = Math.min(rows.length, scrollOffset + fixedViewportLines);
          const max = maxOffset(rows.length);
          const percent = max === 0 ? 100 : Math.round((scrollOffset / max) * 100);

          out.push(borderTop(`╭${"─".repeat(innerW)}╮`));
          out.push(row(theme.fg("accent", ` ${title}`)));
          out.push(
            row(
              theme.fg(
                "dim",
                ` Lines ${start}-${end} / ${rows.length} (${percent}%) • ↑/↓ j/k • Ctrl+u/Ctrl+d • gg/G • Enter/Esc/q`,
              ),
            ),
          );
          out.push(row(""));

          const endIdx = Math.min(rows.length, scrollOffset + fixedViewportLines);
          for (let i = scrollOffset; i < endIdx; i++) {
            out.push(row(rows[i]!));
          }
          for (let i = endIdx - scrollOffset; i < fixedViewportLines; i++) {
            out.push(row(""));
          }

          out.push(row(""));
          out.push(row(theme.fg("dim", " Close this viewer to return to approval.")));
          out.push(borderBottom(`╰${"─".repeat(innerW)}╯`));

          cachedWidth = width;
          cachedScrollOffset = scrollOffset;
          cachedFrame = out;
          return out;
        },
        handleInput(data: string) {
          const terminalWidth =
            typeof tui?.terminal?.columns === "number" ? tui.terminal.columns : 80;
          const innerW = Math.max(20, terminalWidth - 2);
          const rows = buildRows(innerW);
          const pageStep = Math.max(8, Math.floor(fixedViewportLines / 2));

          if (
            matchesKey(data, Key.enter) ||
            matchesKey(data, Key.escape) ||
            data === "q" ||
            data === "Q"
          ) {
            done(undefined);
            return;
          }
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
          pendingG = false;
        },
        invalidate() {
          cachedWidth = undefined;
          cachedScrollOffset = undefined;
          cachedFrame = undefined;
        },
      };
    },
    {},
  );
}
