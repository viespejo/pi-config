/**
 * pi-vertex-anthropic — Claude models on Google Cloud Vertex AI
 *
 * Reuses pi's native "anthropic-messages" provider by injecting AnthropicVertex client.
 * Integrates logic from CodeCompanion adapter for correct Vertex payload handling.
 */

import { AnthropicVertex, ClientOptions } from "@anthropic-ai/vertex-sdk";
import {
  getApiProvider,
  type AnthropicOptions,
  type Api,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const DEFAULT_REGION = "global";
const DEFAULT_MAX_TOKENS_CAP = 32000;

const MODELS = [
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Vertex)",
    reasoning: true,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "max",
    },
    input: ["text", "image"],
    cost: {
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    },
    contextWindow: 1000000,
    maxTokens: 128000,
  },
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7 (Vertex)",
    reasoning: true,
    thinkingLevelMap: {
      off: "none",
      minimal: "low",
      low: "medium",
      medium: "high",
      high: "xhigh",
      xhigh: "max",
    },
    input: ["text", "image"],
    cost: {
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    },
    contextWindow: 1000000,
    maxTokens: 128000,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Vertex)",
    reasoning: true,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "max",
    },
    input: ["text", "image"],
    cost: {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    },
    contextWindow: 1000000,
    maxTokens: 64000,
  },
] satisfies ProviderModelConfig[];

export default function (pi: ExtensionAPI) {
  const project =
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!project) {
    // Silent return if no project is configured
    return;
  }

  const anthropicApi = getApiProvider("anthropic-messages");
  if (!anthropicApi) {
    console.error(
      "Vertex Anthropic: Built-in anthropic-messages provider not found",
    );
    return;
  }

  const region =
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.CLOUD_ML_REGION ||
    DEFAULT_REGION;
  const maxTokensCapRaw = Number(process.env.VERTEX_ANTHROPIC_MAX_TOKENS_CAP);
  const maxTokensCap = Number.isFinite(maxTokensCapRaw)
    ? maxTokensCapRaw
    : DEFAULT_MAX_TOKENS_CAP;

  pi.registerProvider("google-vertex-anthropic", {
    baseUrl: `https://${region}-aiplatform.googleapis.com`,
    apiKey: "$GOOGLE_CLOUD_PROJECT", // Marker
    api: "google-vertex-anthropic",
    models: MODELS,
    streamSimple: (
      model: Model<Api>,
      context,
      options?: SimpleStreamOptions,
    ) => {
      const clientOptions: ClientOptions = { projectId: project, region };

      // Claude 3.x models sometimes need specific headers, but Vertex SDK
      // handles most of the "anthropic-version" logic.
      const client = new AnthropicVertex(clientOptions);

      const anthropicOptions = mapToAnthropicOptions(
        client,
        options,
        model,
        maxTokensCap,
      );

      // Patch API type to reuse native provider
      const patchedModel = { ...model, api: "anthropic-messages" as Api };
      return anthropicApi.stream(patchedModel, context, anthropicOptions);
    },
  });
}

function getDefaultMaxTokens(
  modelMaxTokens: number,
  maxTokensCap?: number,
): number {
  if (!maxTokensCap || maxTokensCap <= 0) return modelMaxTokens;
  return Math.min(modelMaxTokens, maxTokensCap);
}

function mapToAnthropicOptions(
  client: AnthropicVertex,
  options: SimpleStreamOptions | undefined,
  model: Model<Api>,
  maxTokensCap?: number,
): AnthropicOptions {
  const baseMaxTokens =
    options?.maxTokens ?? getDefaultMaxTokens(model.maxTokens, maxTokensCap);
  const baseOptions: AnthropicOptions = {
    client: client as any,
    maxTokens: baseMaxTokens,
    temperature: options?.temperature,
    signal: options?.signal,
    cacheRetention: options?.cacheRetention,
    sessionId: options?.sessionId,
    headers: options?.headers,
    ...buildThinkingOptions(options, model),
  };

  return baseOptions;
}

function buildThinkingOptions(
  options: SimpleStreamOptions | undefined,
  model: Model<Api>,
) {
  if (!options?.reasoning || !model.reasoning) {
    return { thinkingEnabled: false };
  }

  const mappedEffort = model.thinkingLevelMap?.[options.reasoning];

  return {
    thinkingEnabled: true,
    effort: (typeof mappedEffort === "string"
      ? mappedEffort
      : "high") as AnthropicOptions["effort"],
  };
}
