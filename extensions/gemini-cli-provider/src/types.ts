import type { Api, Model, OAuthCredentials } from "@mariozechner/pi-ai";

export const GEMINI_CLI_PROVIDER_ID = "google-gemini-cli" as const;
export const GEMINI_CLI_PROVIDER_DISPLAY_NAME = "Google Gemini CLI";
export const GEMINI_CLI_BASE_URL = "https://cloudcode-pa.googleapis.com";
export const GEMINI_CLI_DEFAULT_MODEL = "gemini-3.1-pro-preview" as const;

export const GEMINI_CLI_SUPPORTED_MODELS = [
	"gemini-3-flash-preview",
	"gemini-3.1-flash-lite-preview",
	"gemini-3.1-pro-preview",
] as const;

export type GeminiCliModelId = (typeof GEMINI_CLI_SUPPORTED_MODELS)[number];

export type GeminiCliCredentials = OAuthCredentials & {
	projectId: string;
};

export interface GeminiCliApiKeyPayload {
	token: string;
	projectId: string;
}

export function isSupportedGeminiCliModel(modelId: string): modelId is GeminiCliModelId {
	return (GEMINI_CLI_SUPPORTED_MODELS as readonly string[]).includes(modelId);
}

export function createUnsupportedModelError(provider: string, modelId: string): Error {
	const supported = GEMINI_CLI_SUPPORTED_MODELS.join(", ");
	return new Error(
		`Unsupported model for provider ${provider}: requested \"${modelId}\". Supported models: ${supported}.`,
	);
}

export function parseGeminiCliApiKey(apiKey: string | undefined): GeminiCliApiKeyPayload {
	if (!apiKey) {
		throw new Error("Google Gemini CLI requires OAuth authentication. Run /login google-gemini-cli.");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(apiKey);
	} catch {
		throw new Error(
			"Invalid Google Gemini CLI credentials format. Run /login google-gemini-cli to re-authenticate.",
		);
	}

	if (!parsed || typeof parsed !== "object") {
		throw new Error("Invalid Google Gemini CLI credentials payload. Run /login google-gemini-cli.");
	}

	const token = (parsed as { token?: unknown }).token;
	const projectId = (parsed as { projectId?: unknown }).projectId;

	if (typeof token !== "string" || token.length === 0 || typeof projectId !== "string" || projectId.length === 0) {
		throw new Error(
			"Missing token or projectId in Google Gemini CLI credentials. Run /login google-gemini-cli.",
		);
	}

	return { token, projectId };
}

export function validateGeminiCliModel(model: Model<Api>): void {
	if (!isSupportedGeminiCliModel(model.id)) {
		throw createUnsupportedModelError(model.provider, model.id);
	}
}

export type DoctorStatus = "ok" | "warn" | "fail";

export const GEMINI_CLI_DOCTOR_CHECK_IDS = {
	providerRegistration: "gemini-cli.provider.registration",
	oauthCredentials: "gemini-cli.oauth.credentials",
	modelSupport: "gemini-cli.model.support",
	endpoint: "gemini-cli.endpoint.fixed",
	liveProbe: "gemini-cli.live.probe",
} as const;

export interface DoctorCheckResult {
	id: (typeof GEMINI_CLI_DOCTOR_CHECK_IDS)[keyof typeof GEMINI_CLI_DOCTOR_CHECK_IDS];
	status: DoctorStatus;
	title: string;
	details: string;
	remediation?: string;
	durationMs?: number;
}

export interface DoctorSummary {
	ok: number;
	warn: number;
	fail: number;
}

export interface DoctorReport {
	status: DoctorStatus;
	provider: typeof GEMINI_CLI_PROVIDER_ID;
	timestamp: string;
	checks: DoctorCheckResult[];
	summary: DoctorSummary;
}

