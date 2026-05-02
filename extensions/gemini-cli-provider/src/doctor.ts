import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { redactText, redactUnknown } from "./redaction";
import {
  createUnsupportedModelError,
  DoctorCheckResult,
  type DoctorReport,
  type DoctorStatus,
  GEMINI_CLI_BASE_URL,
  GEMINI_CLI_DEFAULT_MODEL,
  GEMINI_CLI_DOCTOR_CHECK_IDS,
  GEMINI_CLI_PROVIDER_DISPLAY_NAME,
  GEMINI_CLI_PROVIDER_ID,
  GEMINI_CLI_SUPPORTED_MODELS,
  isSupportedGeminiCliModel,
  parseGeminiCliApiKey,
} from "./types";

interface DoctorOptions {
  json: boolean;
  live: boolean;
  model: string;
  timeoutSeconds: number;
  verbose: boolean;
}

function parseOptions(args: string): DoctorOptions {
  const tokens = args
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  let json = false;
  let live = false;
  let model: string = GEMINI_CLI_DEFAULT_MODEL;
  let timeoutSeconds = 20;
  let verbose = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--live") {
      live = true;
      continue;
    }
    if (token === "--verbose") {
      verbose = true;
      continue;
    }
    if (token === "--model") {
      const value = tokens[i + 1];
      if (!value) throw new Error("Missing value for --model.");
      model = value;
      i += 1;
      continue;
    }
    if (token === "--timeout") {
      const value = tokens[i + 1];
      if (!value) throw new Error("Missing value for --timeout.");
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("Invalid --timeout value. Use a positive integer (seconds).");
      }
      timeoutSeconds = parsed;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { json, live, model, timeoutSeconds, verbose };
}

function aggregateStatus(checks: DoctorCheckResult[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}

function summary(checks: DoctorCheckResult[]): { ok: number; warn: number; fail: number } {
  return {
    ok: checks.filter((check) => check.status === "ok").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
  };
}

function toProviderModelId(modelId: string): string {
  if (modelId.startsWith(`${GEMINI_CLI_PROVIDER_ID}/`)) {
    return modelId.slice(`${GEMINI_CLI_PROVIDER_ID}/`.length);
  }
  return modelId;
}

async function runLiveProbe(modelId: string, timeoutSeconds: number, ctx: ExtensionCommandContext): Promise<DoctorCheckResult> {
  const startedAt = Date.now();
  try {
    const providerApiKey = await ctx.modelRegistry.getApiKeyForProvider(GEMINI_CLI_PROVIDER_ID);
    const credentials = parseGeminiCliApiKey(providerApiKey);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutSeconds * 1000);

    try {
      const response = await fetch(`${GEMINI_CLI_BASE_URL}/v1internal:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "User-Agent": "GeminiCLI/0.35.3/gemini-3.1-pro-preview (linux; x64; terminal) google-api-nodejs-client/9.15.1",
          "X-Goog-Api-Client": "gl-node/22.17.0",
          "Client-Metadata": JSON.stringify({
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          }),
        },
        body: JSON.stringify({
          project: credentials.projectId,
          model: modelId,
          request: {
            contents: [{ role: "user", parts: [{ text: "ping" }] }],
            generationConfig: { maxOutputTokens: 16 },
          },
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          id: GEMINI_CLI_DOCTOR_CHECK_IDS.liveProbe,
          status: "fail",
          title: "Live probe request",
          details: `Live probe failed with status ${response.status}: ${errorText}`,
          remediation: "Re-run /login google-gemini-cli and verify account/project access.",
          durationMs: Date.now() - startedAt,
        };
      }

      return {
        id: GEMINI_CLI_DOCTOR_CHECK_IDS.liveProbe,
        status: "ok",
        title: "Live probe request",
        details: `Live probe succeeded using model ${modelId}.`,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return {
      id: GEMINI_CLI_DOCTOR_CHECK_IDS.liveProbe,
      status: "fail",
      title: "Live probe request",
      details: error instanceof Error ? error.message : String(error),
      remediation: "Ensure OAuth credentials exist and network access to cloudcode-pa.googleapis.com is available.",
      durationMs: Date.now() - startedAt,
    };
  }
}

function formatHumanReport(report: DoctorReport, verbose: boolean): string {
  const lines: string[] = [];
  lines.push(`Provider: ${report.provider} (${GEMINI_CLI_PROVIDER_DISPLAY_NAME})`);
  lines.push(`Status: ${report.status.toUpperCase()}`);
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push("");

  for (const check of report.checks) {
    lines.push(`- [${check.status.toUpperCase()}] ${check.id} :: ${check.title}`);
    lines.push(`  ${check.details}`);
    if (check.remediation && check.status !== "ok") {
      lines.push(`  Remediation: ${check.remediation}`);
    }
    if (verbose && typeof check.durationMs === "number") {
      lines.push(`  Duration: ${check.durationMs}ms`);
    }
  }

  lines.push("");
  lines.push(`Summary: ok=${report.summary.ok} warn=${report.summary.warn} fail=${report.summary.fail}`);
  return redactText(lines.join("\n"));
}

function buildReport(checks: DoctorCheckResult[]): DoctorReport {
  const status = aggregateStatus(checks);
  return redactUnknown({
    status,
    provider: GEMINI_CLI_PROVIDER_ID,
    timestamp: new Date().toISOString(),
    checks,
    summary: summary(checks),
  }) as DoctorReport;
}

export async function runGeminiCliDoctor(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const options = parseOptions(args);
  const checks: DoctorCheckResult[] = [];

  const displayName = ctx.modelRegistry.getProviderDisplayName(GEMINI_CLI_PROVIDER_ID);
  checks.push({
    id: GEMINI_CLI_DOCTOR_CHECK_IDS.providerRegistration,
    status: displayName === GEMINI_CLI_PROVIDER_DISPLAY_NAME ? "ok" : "fail",
    title: "Provider registration",
    details:
      displayName === GEMINI_CLI_PROVIDER_DISPLAY_NAME
        ? `Provider ${GEMINI_CLI_PROVIDER_ID} is registered with expected display name.`
        : `Provider display name mismatch. Found: ${displayName}`,
    remediation:
      displayName === GEMINI_CLI_PROVIDER_DISPLAY_NAME
        ? undefined
        : "Reload extensions and verify .pi/extensions/gemini-cli-provider/index.ts registers google-gemini-cli.",
  });

  const authStatus = ctx.modelRegistry.getProviderAuthStatus(GEMINI_CLI_PROVIDER_ID);
  checks.push({
    id: GEMINI_CLI_DOCTOR_CHECK_IDS.oauthCredentials,
    status: authStatus.configured ? "ok" : "fail",
    title: "OAuth credentials",
    details: authStatus.configured
      ? `OAuth credentials are configured (${authStatus.source ?? "unknown source"}).`
      : "No OAuth credentials found for google-gemini-cli.",
    remediation: authStatus.configured ? undefined : "Run /login google-gemini-cli and complete the OAuth flow.",
  });

  const requestedModel = toProviderModelId(options.model);
  checks.push({
    id: GEMINI_CLI_DOCTOR_CHECK_IDS.modelSupport,
    status: isSupportedGeminiCliModel(requestedModel) ? "ok" : "fail",
    title: "Model support policy",
    details: isSupportedGeminiCliModel(requestedModel)
      ? `Requested model ${requestedModel} is supported.`
      : createUnsupportedModelError(GEMINI_CLI_PROVIDER_ID, requestedModel).message,
    remediation: isSupportedGeminiCliModel(requestedModel)
      ? undefined
      : `Use one of: ${GEMINI_CLI_SUPPORTED_MODELS.join(", ")}.`,
  });

  const activeModel = ctx.model as Model<Api> | undefined;
  if (
    activeModel &&
    activeModel.provider === GEMINI_CLI_PROVIDER_ID &&
    !isSupportedGeminiCliModel(activeModel.id)
  ) {
    checks.push({
      id: GEMINI_CLI_DOCTOR_CHECK_IDS.modelSupport,
      status: "fail",
      title: "Active model support policy",
      details: createUnsupportedModelError(GEMINI_CLI_PROVIDER_ID, activeModel.id).message,
      remediation: `Switch to one of: ${GEMINI_CLI_SUPPORTED_MODELS.join(", ")}.`,
    });
  }

  const endpointStatus =
    !activeModel || activeModel.provider !== GEMINI_CLI_PROVIDER_ID || activeModel.baseUrl === GEMINI_CLI_BASE_URL
      ? "ok"
      : "fail";
  checks.push({
    id: GEMINI_CLI_DOCTOR_CHECK_IDS.endpoint,
    status: endpointStatus,
    title: "Fixed endpoint configuration",
    details:
      endpointStatus === "ok"
        ? `Provider endpoint is fixed to ${GEMINI_CLI_BASE_URL}.`
        : `Active model endpoint mismatch: ${activeModel?.baseUrl}`,
    remediation:
      endpointStatus === "ok"
        ? undefined
        : `Remove endpoint overrides and keep ${GEMINI_CLI_BASE_URL}.`,
  });

  if (options.live) {
    checks.push(await runLiveProbe(requestedModel, options.timeoutSeconds, ctx));
  } else {
    checks.push({
      id: GEMINI_CLI_DOCTOR_CHECK_IDS.liveProbe,
      status: "ok",
      title: "Live probe request",
      details: "Skipped (run with --live to execute network probe).",
    });
  }

  const report = buildReport(checks);
  if (options.json) {
    console.log(JSON.stringify(report));
  } else {
    console.log(formatHumanReport(report, options.verbose));
  }

  if (report.status === "fail" && !ctx.hasUI) {
    process.exitCode = 1;
  }
}
