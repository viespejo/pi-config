import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGeminiCliDoctor } from "../src/doctor";
import { GEMINI_CLI_DOCTOR_CHECK_IDS } from "../src/types";

type MockCtx = {
	hasUI: boolean;
	model?: { provider: string; id: string; baseUrl: string };
	modelRegistry: {
		getProviderDisplayName: (provider: string) => string;
		getProviderAuthStatus: (provider: string) => { configured: boolean; source?: string };
		getApiKeyForProvider: (provider: string) => Promise<string | undefined>;
	};
};

function createContext(overrides?: Partial<MockCtx>): MockCtx {
	return {
		hasUI: false,
		model: { provider: "google-gemini-cli", id: "gemini-3.1-pro-preview", baseUrl: "https://cloudcode-pa.googleapis.com" },
		modelRegistry: {
			getProviderDisplayName: () => "Google Gemini CLI",
			getProviderAuthStatus: () => ({ configured: true, source: "oauth" }),
			getApiKeyForProvider: async () => JSON.stringify({ token: "top-secret-token", projectId: "proj-12345" }),
		},
		...overrides,
	};
}

describe("/gemini-cli-doctor", () => {
	const originalFetch = globalThis.fetch;
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

	beforeEach(() => {
		process.exitCode = undefined;
		globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => "", body: null })) as unknown as typeof fetch;
		logSpy.mockClear();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.exitCode = undefined;
	});

	it("emits single-line JSON output with required schema and stable check IDs", async () => {
		const ctx = createContext();
		await runGeminiCliDoctor("--json", ctx as never);

		expect(logSpy).toHaveBeenCalledTimes(1);
		const output = String(logSpy.mock.calls[0]?.[0]);
		expect(output.includes("\n")).toBe(false);
		const report = JSON.parse(output) as {
			status: string;
			provider: string;
			timestamp: string;
			checks: Array<{ id: string; status: string }>;
			summary: { ok: number; warn: number; fail: number };
		};

		expect(report.provider).toBe("google-gemini-cli");
		expect(typeof report.timestamp).toBe("string");
		expect(Array.isArray(report.checks)).toBe(true);
		expect(report.checks.map((check) => check.id)).toEqual(
			expect.arrayContaining(Object.values(GEMINI_CLI_DOCTOR_CHECK_IDS)),
		);
		expect(report.summary.ok + report.summary.warn + report.summary.fail).toBe(report.checks.length);
	});

	it("does not use network by default without --live", async () => {
		const ctx = createContext();
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		await runGeminiCliDoctor("--json", ctx as never);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("maps missing OAuth credentials to fail and non-interactive exit code 1", async () => {
		const ctx = createContext({
			modelRegistry: {
				getProviderDisplayName: () => "Google Gemini CLI",
				getProviderAuthStatus: () => ({ configured: false }),
				getApiKeyForProvider: async () => undefined,
			},
		});

		await runGeminiCliDoctor("--json", ctx as never);
		const report = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as { status: string; checks: Array<{ id: string; status: string }> };
		expect(report.status).toBe("fail");
		expect(report.checks.some((check) => check.id === GEMINI_CLI_DOCTOR_CHECK_IDS.oauthCredentials && check.status === "fail")).toBe(true);
		expect(process.exitCode).toBe(1);
	});

	it("runs live probe only when --live is provided", async () => {
		const ctx = createContext();
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		await runGeminiCliDoctor("--json --live", ctx as never);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("redacts sensitive values in JSON output", async () => {
		const ctx = createContext();
		globalThis.fetch = vi.fn(async () => ({
			ok: false,
			status: 401,
			text: async () => "authorization: Bearer top-secret-token access_token=abc123",
			body: null,
		})) as unknown as typeof fetch;

		await runGeminiCliDoctor("--json --live", ctx as never);
		const output = String(logSpy.mock.calls[0]?.[0]);
		expect(output).not.toContain("top-secret-token");
		expect(output).not.toContain("abc123");
		expect(output).toContain("[REDACTED]");
	});
});
