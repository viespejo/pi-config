import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { runGeminiCliDoctor } from "./doctor";
import { geminiCliProviderConfig } from "./provider";
import { GEMINI_CLI_PROVIDER_ID } from "./types";

export default function registerGeminiCliProviderExtension(pi: ExtensionAPI): void {
	pi.registerProvider(GEMINI_CLI_PROVIDER_ID, geminiCliProviderConfig);
	pi.registerCommand("gemini-cli-doctor", {
		description: "Diagnose Google Gemini CLI provider configuration and connectivity.",
		handler: async (args, ctx) => {
			await runGeminiCliDoctor(args, ctx);
		},
	});
}
