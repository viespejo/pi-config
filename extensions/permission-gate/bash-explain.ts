import { completeSimple, type UserMessage } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

const EXPLAIN_TIMEOUT_MS = 15_000;
const MAX_COMMAND_CHARS = 4_000;

const PREFERRED_EXPLAIN_MODELS = [
  ["google-gemini-cli", "gemini-3-flash-preview"],
  ["github-copilot", "gpt-5-mini"],
] as const;

const EXPLAIN_SYSTEM_PROMPT = `You explain shell commands for human approval decisions.

Return ONLY valid JSON with this exact structure:
{
  "summary": "string",
  "risks": ["string"],
  "impact": "string",
  "recommendation": "safe-ish|caution|dangerous",
  "flags": ["string"]
}

Rules:
- Write concise, practical English.
- Keep risks and flags focused; include up to 4 each.
- If unsure about a fact, say "unknown" instead of guessing.
- Recommendation must be exactly one of: safe-ish, caution, dangerous.
- Do not include markdown or any text outside JSON.`;

type ExplainCtx = Pick<ExtensionContext, "model" | "modelRegistry" | "ui">;

type ExplainerOutput = {
  summary: string;
  risks: string[];
  impact: string;
  recommendation: string;
  flags?: string[];
};

export type BashExplanationRecommendation = "safe-ish" | "caution" | "dangerous";

export type BashExplanationSuccess = {
  ok: true;
  explanation: {
    summary: string;
    risks: string[];
    impact: string;
    recommendation: BashExplanationRecommendation;
    flags?: string[];
  };
  meta: {
    commandWasTruncated: boolean;
    originalCommandLength: number;
    usedCommandLength: number;
    model: {
      provider: string;
      id: string;
    };
  };
};

export type BashExplanationError = {
  ok: false;
  error: {
    code:
      | "no-model"
      | "auth"
      | "timeout"
      | "invalid-json"
      | "invalid-shape"
      | "model-error";
    message: string;
  };
};

export type BashExplanationResult = BashExplanationSuccess | BashExplanationError;

function selectExplanationModel(ctx: ExplainCtx): Model<Api> | undefined {
  const availableModels = ctx.modelRegistry.getAvailable();

  const preferredModel = PREFERRED_EXPLAIN_MODELS.map(([provider, id]) =>
    availableModels.find(
      (m) =>
        m.provider.toLowerCase() === provider.toLowerCase() &&
        m.id.toLowerCase() === id.toLowerCase(),
    ),
  ).find(Boolean);

  return preferredModel ?? ctx.model;
}

function truncateCommand(command: string) {
  const commandWasTruncated = command.length > MAX_COMMAND_CHARS;
  const usedCommand = commandWasTruncated
    ? command.slice(0, MAX_COMMAND_CHARS)
    : command;

  return {
    usedCommand,
    commandWasTruncated,
    originalCommandLength: command.length,
    usedCommandLength: usedCommand.length,
  };
}

function extractTextContent(responseText: string) {
  const fenced = responseText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1]!.trim() : responseText.trim();
}

function parseExplainerJson(responseText: string): ExplainerOutput | null {
  try {
    const json = extractTextContent(responseText);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;

    const summary = (parsed as Record<string, unknown>).summary;
    const risks = (parsed as Record<string, unknown>).risks;
    const impact = (parsed as Record<string, unknown>).impact;
    const recommendation = (parsed as Record<string, unknown>).recommendation;
    const flags = (parsed as Record<string, unknown>).flags;

    if (typeof summary !== "string") return null;
    if (!Array.isArray(risks) || !risks.every((r) => typeof r === "string")) {
      return null;
    }
    if (typeof impact !== "string") return null;
    if (typeof recommendation !== "string") return null;
    if (
      flags !== undefined &&
      (!Array.isArray(flags) || !flags.every((f) => typeof f === "string"))
    ) {
      return null;
    }

    return {
      summary,
      risks,
      impact,
      recommendation,
      ...(flags ? { flags } : {}),
    };
  } catch {
    return null;
  }
}

function normalizeList(items: string[] | undefined, maxItems: number) {
  if (!items) return undefined;

  const normalized = items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, maxItems);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRecommendation(value: string): BashExplanationRecommendation {
  const raw = value.trim().toLowerCase();
  if (raw === "safe-ish") return "safe-ish";
  if (raw === "caution") return "caution";
  if (raw === "dangerous") return "dangerous";
  return "caution";
}

function buildExplainUserPrompt(params: {
  command: string;
  cwd: string;
  configuredReason?: string;
  highRiskReasons?: string[];
}) {
  const lines = [
    "Explain this bash command for an approval gate.",
    `cwd: ${params.cwd}`,
    "command:",
    params.command,
  ];

  if (params.configuredReason) {
    lines.push("policy_reason:");
    lines.push(params.configuredReason);
  }

  if (params.highRiskReasons && params.highRiskReasons.length > 0) {
    lines.push("high_risk_reasons:");
    for (const reason of params.highRiskReasons) {
      lines.push(`- ${reason}`);
    }
  }

  return lines.join("\n");
}

export async function generateBashExplanation(params: {
  command: string;
  cwd: string;
  ctx: ExplainCtx;
  configuredReason?: string;
  highRiskReasons?: string[];
}): Promise<BashExplanationResult> {
  try {
    const model = selectExplanationModel(params.ctx);
    if (!model) {
      return {
        ok: false,
        error: {
          code: "no-model",
          message: "No model available for command explanation.",
        },
      };
    }

    const auth = await params.ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      return {
        ok: false,
        error: {
          code: "auth",
          message: auth.error,
        },
      };
    }

    const truncated = truncateCommand(params.command);
    const userMessage: UserMessage = {
      role: "user",
      content: [
        {
          type: "text",
          text: buildExplainUserPrompt({
            command: truncated.usedCommand,
            cwd: params.cwd,
            configuredReason: params.configuredReason,
            highRiskReasons: params.highRiskReasons,
          }),
        },
      ],
      timestamp: Date.now(),
    };

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), EXPLAIN_TIMEOUT_MS);

    const reasoning = model.reasoning ? "minimal" : undefined;

    try {
      const response = await completeSimple(
        model,
        {
          systemPrompt: EXPLAIN_SYSTEM_PROMPT,
          messages: [userMessage],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          signal: timeoutController.signal,
          ...(reasoning ? { reasoning } : {}),
        },
      );

      const responseText = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();

      const parsed = parseExplainerJson(responseText);
      if (!parsed) {
        return {
          ok: false,
          error: {
            code: "invalid-json",
            message: "Explainer did not return valid JSON.",
          },
        };
      }

      const risks = normalizeList(parsed.risks, 4);
      if (!risks) {
        return {
          ok: false,
          error: {
            code: "invalid-shape",
            message: "Explainer JSON missing non-empty risks.",
          },
        };
      }

      const flags = normalizeList(parsed.flags, 4);

      return {
        ok: true,
        explanation: {
          summary: parsed.summary.trim() || "unknown",
          risks,
          impact: parsed.impact.trim() || "unknown",
          recommendation: normalizeRecommendation(parsed.recommendation),
          ...(flags ? { flags } : {}),
        },
        meta: {
          commandWasTruncated: truncated.commandWasTruncated,
          originalCommandLength: truncated.originalCommandLength,
          usedCommandLength: truncated.usedCommandLength,
          model: {
            provider: model.provider,
            id: model.id,
          },
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeoutLike = /aborted|abort|timeout/i.test(message);

    return {
      ok: false,
      error: {
        code: timeoutLike ? "timeout" : "model-error",
        message,
      },
    };
  }
}
