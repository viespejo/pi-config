import { describe, expect, it } from "vitest";
import { geminiCliProviderConfig } from "../src/provider";
import {
	createUnsupportedModelError,
	GEMINI_CLI_BASE_URL,
	GEMINI_CLI_DEFAULT_MODEL,
	GEMINI_CLI_PROVIDER_DISPLAY_NAME,
	GEMINI_CLI_PROVIDER_ID,
	GEMINI_CLI_SUPPORTED_MODELS,
	isSupportedGeminiCliModel,
} from "../src/types";

describe("gemini-cli provider", () => {
	it("uses the contractual provider identity and display name", () => {
		expect(GEMINI_CLI_PROVIDER_ID).toBe("google-gemini-cli");
		expect(geminiCliProviderConfig.name).toBe(GEMINI_CLI_PROVIDER_DISPLAY_NAME);
	});

	it("registers only the approved 3-model catalog and fixed endpoint", () => {
		const modelIds = (geminiCliProviderConfig.models ?? []).map((model: { id: string }) => model.id);
		expect(modelIds).toEqual([
			"gemini-3.1-pro-preview",
			"gemini-3-flash-preview",
			"gemini-3.1-flash-lite-preview",
		]);
		expect(modelIds.slice().sort()).toEqual([...GEMINI_CLI_SUPPORTED_MODELS].sort());
		expect(modelIds).not.toContain("google-antigravity");
		expect(geminiCliProviderConfig.baseUrl).toBe(GEMINI_CLI_BASE_URL);
		expect(
			geminiCliProviderConfig.models?.every((model: { baseUrl?: string }) => model.baseUrl === GEMINI_CLI_BASE_URL),
		).toBe(true);
		expect(GEMINI_CLI_DEFAULT_MODEL).toBe("gemini-3.1-pro-preview");
	});

	it("rejects unsupported models with actionable contract message", () => {
		const error = createUnsupportedModelError("google-gemini-cli", "gemini-legacy");
		expect(error.message).toContain("provider google-gemini-cli");
		expect(error.message).toContain('requested "gemini-legacy"');
		for (const modelId of GEMINI_CLI_SUPPORTED_MODELS) {
			expect(error.message).toContain(modelId);
		}
		expect(isSupportedGeminiCliModel("gemini-legacy")).toBe(false);
	});

	it("uses dedicated stream implementation", () => {
		expect(typeof geminiCliProviderConfig.streamSimple).toBe("function");
	});
});
