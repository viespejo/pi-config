import { type ExtensionAPI, type Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, type TUI, Container, Spacer, Text } from "@mariozechner/pi-tui";
import { fetchAllUsages, type ProviderUsage } from "./core";

// ── Helpers ──────────────────────────────────────────────────────

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function colorForPercent(value: number): "success" | "warning" | "error" {
  if (value >= 90) return "error";
  if (value >= 70) return "warning";
  return "success";
}

function renderBar(theme: Theme, value: number, width = 20): string {
  const v = clampPercent(value);
  const filled = Math.round((v / 100) * width);
  const full = "█".repeat(Math.max(0, Math.min(width, filled)));
  const empty = "░".repeat(Math.max(0, width - filled));
  return theme.fg(colorForPercent(v), full) + theme.fg("dim", empty);
}

// ── Usage Panel Component ────────────────────────────────────────

class UsagePanelComponent {
  private container = new Container();
  private loading = true;
  private data: ProviderUsage[] = [];
  private onDone: () => void;
  private tui: TUI;
  private theme: Theme;

  constructor(tui: TUI, theme: Theme, onDone: () => void) {
    this.tui = tui;
    this.theme = theme;
    this.onDone = onDone;
    this.rebuild();
  }

  setData(data: ProviderUsage[]) {
    this.data = data;
    this.loading = false;
    this.rebuild();
    this.tui.requestRender();
  }

  private rebuild() {
    this.container.clear();
    const t = this.theme;

    this.container.addChild(new Spacer(1));
    this.container.addChild(new Text("  " + t.fg("accent", t.bold("Usage Status")), 0, 0));
    this.container.addChild(new Spacer(1));

    if (this.loading) {
      this.container.addChild(new Text("  " + t.fg("muted", "Fetching usage data..."), 0, 0));
    } else {
      for (const provider of this.data) {
        this.renderProvider(provider);
      }
      this.container.addChild(new Spacer(1));
      this.container.addChild(new Text("  " + t.fg("dim", "Press q or Escape to close"), 0, 0));
    }
    this.container.addChild(new Spacer(1));
  }

  private renderProvider(p: ProviderUsage) {
    const t = this.theme;
    this.container.addChild(new Text("  " + t.fg("accent", p.provider), 0, 0));

    if (p.error) {
      this.container.addChild(new Text("    " + t.fg("error", p.error), 0, 0));
      return;
    }

    for (const q of p.quotas) {
      const dailyLabel = q.name ? `    ${q.name.padEnd(6)} ` : "    Daily  ";
      const session = clampPercent(q.session);
      const sessionReset = q.sessionResetsIn ? t.fg("dim", ` (resets in ${q.sessionResetsIn})`) : "";

      this.container.addChild(new Text(
        dailyLabel + renderBar(t, session) + " " +
        t.fg(colorForPercent(session), `${session}%`.padStart(4)) +
        sessionReset,
        0, 0
      ));

      // For Gemini model breakdown (Pro/Flash), keep a single clean line.
      if (q.name) continue;

      const weekly = clampPercent(q.weekly);
      const weeklyReset = q.weeklyResetsIn ? t.fg("dim", ` (resets in ${q.weeklyResetsIn})`) : "";
      this.container.addChild(new Text(
        "    Weekly " + renderBar(t, weekly) + " " +
        t.fg(colorForPercent(weekly), `${weekly}%`.padStart(4)) +
        weeklyReset,
        0, 0
      ));
    }
  }

  render(width: number): string[] {
    return this.container.render(width);
  }

  invalidate() {
    this.container.invalidate();
    this.rebuild();
  }

  handleInput(data: string) {
    if (matchesKey(data, "q") || matchesKey(data, "escape")) {
      this.onDone();
    }
  }
}

// ── Extension entry point ────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("usage", {
    description: "Display current subscription quotas for Claude, Codex, and Gemini",
    handler: async (_args, ctx) => {
      if (!ctx?.hasUI) return;

      await ctx.ui.custom<void>((tui, theme, _kb, done) => {
        const component = new UsagePanelComponent(tui, theme, done);
        
        fetchAllUsages().then(data => {
          component.setData(data);
        }).catch(err => {
          component.setData([
            { provider: "Claude", quotas: [], error: String(err) },
            { provider: "Codex", quotas: [], error: String(err) },
            { provider: "Gemini", quotas: [], error: String(err) }
          ]);
        });

        return component;
      });
    },
  });
}
