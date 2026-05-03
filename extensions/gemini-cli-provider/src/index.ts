import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { Container, matchesKey, Spacer, Text, type TUI } from "@mariozechner/pi-tui";
import { runGeminiCliDoctor } from "./doctor";
import { geminiCliProviderConfig } from "./provider";
import { GEMINI_CLI_PROVIDER_ID } from "./types";

class DoctorReportPanel {
	private container = new Container();

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly title: string,
		private readonly body: string,
		private readonly onDone: () => void,
	) {
		this.rebuild();
	}

	private rebuild(): void {
		this.container.clear();
		this.container.addChild(new Spacer(1));
		this.container.addChild(new Text(`  ${this.theme.fg("accent", this.theme.bold(this.title))}`, 0, 0));
		this.container.addChild(new Spacer(1));
		for (const line of this.body.split("\n")) {
			this.container.addChild(new Text(`  ${line}`, 0, 0));
		}
		this.container.addChild(new Spacer(1));
		this.container.addChild(new Text(`  ${this.theme.fg("dim", "Press q or Escape to close")}`, 0, 0));
		this.container.addChild(new Spacer(1));
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "q") || matchesKey(data, "escape")) {
			this.onDone();
		}
	}
}

export default function registerGeminiCliProviderExtension(pi: ExtensionAPI): void {
	pi.registerProvider(GEMINI_CLI_PROVIDER_ID, geminiCliProviderConfig);
	pi.registerCommand("gemini-cli-doctor", {
		description: "Diagnose Google Gemini CLI provider configuration and connectivity.",
		handler: async (args, ctx) => {
			await runGeminiCliDoctor(args, ctx, {
				onHumanReport: ({ text, status }) => {
					if (!ctx.hasUI) {
						console.log(text);
						return;
					}
					void ctx.ui.custom<void>((tui, theme, _kb, done) => {
						return new DoctorReportPanel(
							tui,
							theme,
							`Gemini CLI Doctor (${status.toUpperCase()})`,
							text,
							done,
						);
					});
				},
			});
		},
	});
}
