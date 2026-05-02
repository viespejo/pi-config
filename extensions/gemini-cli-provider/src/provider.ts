import type { ProviderConfig } from "@mariozechner/pi-coding-agent";
import { geminiCliOAuthConfig } from "./oauth";
import { streamGeminiCli } from "./stream";
import {
	GEMINI_CLI_BASE_URL,
	GEMINI_CLI_DEFAULT_MODEL,
	GEMINI_CLI_PROVIDER_DISPLAY_NAME,
	GEMINI_CLI_SUPPORTED_MODELS,
} from "./types";

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const geminiCliProviderConfig: ProviderConfig = {
	name: GEMINI_CLI_PROVIDER_DISPLAY_NAME,
	baseUrl: GEMINI_CLI_BASE_URL,
	api: "google-gemini-cli",
	oauth: geminiCliOAuthConfig,
	streamSimple: streamGeminiCli,
	models: [
		{
			id: GEMINI_CLI_SUPPORTED_MODELS[2],
			name: "Gemini 3.1 Pro Preview",
			api: "google-gemini-cli",
			baseUrl: GEMINI_CLI_BASE_URL,
			reasoning: true,
			thinkingLevelMap: {
				minimal: "LOW",
				low: "LOW",
				medium: "HIGH",
				high: "HIGH",
			},
			input: ["text", "image"],
			cost: zeroCost,
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		{
			id: GEMINI_CLI_SUPPORTED_MODELS[0],
			name: "Gemini 3 Flash Preview",
			api: "google-gemini-cli",
			baseUrl: GEMINI_CLI_BASE_URL,
			reasoning: true,
			thinkingLevelMap: {
				minimal: "MINIMAL",
				low: "LOW",
				medium: "MEDIUM",
				high: "HIGH",
			},
			input: ["text", "image"],
			cost: zeroCost,
			contextWindow: 1048576,
			maxTokens: 65536,
		},
		{
			id: GEMINI_CLI_SUPPORTED_MODELS[1],
			name: "Gemini 3.1 Flash Lite Preview",
			api: "google-gemini-cli",
			baseUrl: GEMINI_CLI_BASE_URL,
			reasoning: true,
			thinkingLevelMap: {
				minimal: "MINIMAL",
				low: "LOW",
				medium: "MEDIUM",
				high: "HIGH",
			},
			input: ["text", "image"],
			cost: zeroCost,
			contextWindow: 1048576,
			maxTokens: 65536,
		},
	],
};

export { GEMINI_CLI_DEFAULT_MODEL };
