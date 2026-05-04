import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import {
  type Component,
  fuzzyFilter,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";

export interface InterviewContextOption {
  slug: string;
  mtimeMs: number;
}

type KeybindingsLike = {
  matches(data: string, id: string): boolean;
};

interface SelectorResult {
  selectedSlug: string | null | "__CANCELLED__";
}

export async function selectInterviewContext(
  ctx: ExtensionCommandContext,
  options: InterviewContextOption[],
): Promise<string | null | "__CANCELLED__"> {
  if (!ctx.hasUI) return null;

  const result = await ctx.ui.custom<SelectorResult>((tui, theme, keybindings, done) =>
    new InterviewContextSelector(tui, theme, keybindings, options, done),
  );

  if (result === undefined) {
    const noneLabel = "No usar contexto de entrevista";
    const labels = [
      noneLabel,
      ...options.map((o) => `${o.slug} (${new Date(o.mtimeMs).toISOString().slice(0, 10)})`),
    ];
    const selected = await ctx.ui.select("Select technical interview context", labels);
    if (selected === undefined) return "__CANCELLED__";
    if (selected === noneLabel) return null;
    return selected.split(" (")[0]?.trim() ?? null;
  }

  return result.selectedSlug;
}

class InterviewContextSelector implements Component {
  private closed = false;
  private searchMode = false;
  private searchQuery = "";
  private selectedIndex = 0;
  private scrollOffset = 0;
  private filtered: InterviewContextOption[];

  constructor(
    private readonly tui: { requestRender: () => void },
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsLike,
    private readonly all: InterviewContextOption[],
    private readonly done: (result: SelectorResult) => void,
  ) {
    this.filtered = [...all];
  }

  handleInput(data: string): void {
    const kb = this.keybindings;

    if (this.searchMode) {
      if (kb.matches(data, "tui.select.cancel")) {
        this.searchQuery = "";
        this.searchMode = false;
        this.refresh();
        return;
      }
      if (kb.matches(data, "tui.select.confirm")) {
        this.searchMode = false;
        this.tui.requestRender();
        return;
      }
      if (data === "\x7f") {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.refresh();
        return;
      }
      if (data === "/") return;
      if (data.length === 1 && data >= " " && data <= "~") {
        this.searchQuery += data;
        this.refresh();
      }
      return;
    }

    if (data === "/") {
      this.searchMode = true;
      this.searchQuery = "";
      this.tui.requestRender();
      return;
    }

    if (kb.matches(data, "tui.select.up") || data === "k") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.ensureScrollVisible();
      this.tui.requestRender();
      return;
    }

    if (kb.matches(data, "tui.select.down") || data === "j") {
      this.selectedIndex = Math.min(this.filtered.length, this.selectedIndex + 1);
      this.ensureScrollVisible();
      this.tui.requestRender();
      return;
    }

    if (kb.matches(data, "tui.select.confirm")) {
      if (this.selectedIndex === 0) {
        this.finish({ selectedSlug: null });
        return;
      }
      const selected = this.filtered[this.selectedIndex - 1];
      this.finish({ selectedSlug: selected?.slug ?? null });
      return;
    }

    if (kb.matches(data, "tui.select.cancel")) {
      this.finish({ selectedSlug: "__CANCELLED__" });
    }
  }

  render(width: number): string[] {
    const dim = (s: string) => this.theme.fg("dim", s);
    const accent = (s: string) => this.theme.fg("accent", s);
    const border = (s: string) => this.theme.fg("dim", s);
    const lines: string[] = [];

    const innerWidth = Math.max(1, width - 2);
    const pad = (content: string) => {
      const len = visibleWidth(content);
      return ` ${content}${" ".repeat(Math.max(0, innerWidth - len))} `;
    };

    lines.push(border("─".repeat(width)));
    lines.push(pad(accent("Technical interview context")));
    lines.push(
      pad(
        this.searchMode
          ? accent(`/ ${this.searchQuery}${this.searchQuery ? "_" : ""}`)
          : dim(
              this.searchQuery
                ? `Search: ${this.searchQuery}`
                : "Use / to search, Enter to select",
            ),
      ),
    );
    lines.push(border("─".repeat(width)));

    const rows: string[] = [];
    rows.push(this.rowLabel("No usar contexto de entrevista", this.selectedIndex === 0, width));

    for (let i = 0; i < this.filtered.length; i++) {
      const item = this.filtered[i];
      if (!item) continue;
      const label = `${item.slug} (${new Date(item.mtimeMs).toISOString().slice(0, 10)})`;
      rows.push(this.rowLabel(label, this.selectedIndex === i + 1, width));
    }

    const visibleRows = 12;
    if (rows.length === 1) {
      rows.push(pad(dim("No interviews available")));
    }

    const maxOffset = Math.max(0, rows.length - visibleRows);
    const start = Math.min(this.scrollOffset, maxOffset);
    const end = start + visibleRows;
    const visible = rows.slice(start, end);

    lines.push(...visible);
    for (let i = visible.length; i < visibleRows; i++) {
      lines.push(pad(""));
    }

    lines.push(border("─".repeat(width)));
    const rangeText = rows.length > visibleRows ? `Showing ${start + 1}-${Math.min(end, rows.length)} of ${rows.length}` : `Total: ${rows.length}`;
    lines.push(pad(dim(`${rangeText}  ·  ↑/↓ move  Enter select  / search  Esc cancel`)));
    lines.push(border("─".repeat(width)));

    return lines;
  }

  invalidate(): void {}

  private refresh(): void {
    if (!this.searchQuery) {
      this.filtered = [...this.all];
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }

    this.filtered = fuzzyFilter(
      this.all,
      this.searchQuery,
      (item) => `${item.slug} ${new Date(item.mtimeMs).toISOString().slice(0, 10)}`,
    );

    this.selectedIndex = Math.min(this.selectedIndex, this.filtered.length);
    this.ensureScrollVisible();
    this.tui.requestRender();
  }

  private ensureScrollVisible(): void {
    const visibleRows = 12;
    const totalRows = this.filtered.length + 1;
    const maxOffset = Math.max(0, totalRows - visibleRows);

    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + visibleRows) {
      this.scrollOffset = this.selectedIndex - visibleRows + 1;
    }

    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
  }

  private rowLabel(label: string, selected: boolean, width: number): string {
    const prefix = selected ? `${this.theme.fg("accent", "▶")} ` : "  ";
    const content = truncateToWidth(`${prefix}${label}`, Math.max(1, width - 2), "...");
    const len = visibleWidth(content);
    return ` ${content}${" ".repeat(Math.max(0, width - 2 - len))} `;
  }

  private finish(result: SelectorResult): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }
}
