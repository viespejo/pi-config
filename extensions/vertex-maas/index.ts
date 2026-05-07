/**
 * pi-vertex-maas — Vertex AI Model-as-a-Service models via OpenAI-compatible endpoint.
 *
 * Reuses pi's native "openai-completions" provider and injects Google access tokens.
 */

import { execSync } from "node:child_process";
import {
  getApiProvider,
  type Api,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const DEFAULT_REGION = "global";

const MODELS = [
  {
    id: "zai-org/glm-5-maas",
    name: "GLM 5 (Vertex MAAS)",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1, output: 3.2, cacheRead: 0.1, cacheWrite: 1 },
    contextWindow: 128000,
    maxTokens: 32768,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    },
  },
  {
    id: "moonshotai/kimi-k2-thinking-maas",
    name: "Kimi K2 Thinking (Vertex MAAS)",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.6, output: 2.5, cacheRead: 0.06, cacheWrite: 0.6 },
    contextWindow: 128000,
    maxTokens: 32768,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    },
  },
  {
    id: "minimaxai/minimax-m2-maas",
    name: "Minimax M2 (Vertex MAAS)",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.3 },
    contextWindow: 128000,
    maxTokens: 32768,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    },
  },
  {
    id: "deepseek-v3.2-maas",
    name: "DeepSeek v3.2 (Vertex MAAS)",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32768,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: "max_tokens",
    },
  },
] satisfies ProviderModelConfig[];

export default function (pi: ExtensionAPI) {
  const project =
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!project) return;

  const openaiCompletionsApi = getApiProvider("openai-completions");
  if (!openaiCompletionsApi) {
    console.error(
      "Vertex MAAS: Built-in openai-completions provider not found",
    );
    return;
  }

  const region =
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.CLOUD_ML_REGION ||
    DEFAULT_REGION;

  const baseUrl = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/endpoints/openapi`;

  pi.registerProvider("google-vertex-maas", {
    name: "Google Vertex MAAS",
    baseUrl,
    apiKey: "GOOGLE_CLOUD_PROJECT",
    api: "openai-completions",
    models: MODELS,
    streamSimple: (
      model: Model<Api>,
      context,
      options?: SimpleStreamOptions,
    ) => {
      try {
        const accessToken = getAccessToken();
        const modelWithEndpoint: Model<Api> = {
          ...model,
          baseUrl,
        };

        return openaiCompletionsApi.streamSimple(modelWithEndpoint, context, {
          ...options,
          apiKey: accessToken,
        });
      } catch (error) {
        console.error(`Vertex MAAS streamSimple failed: ${String(error)}`);
        throw error;
      }
    },
  });
}

function getAccessToken(): string {
  const envToken =
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN || process.env.VERTEX_ACCESS_TOKEN;
  if (envToken && envToken.trim()) {
    return envToken.trim();
  }

  try {
    const token = execSync("gcloud auth print-access-token", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    }).trim();

    if (!token) {
      throw new Error("empty token");
    }

    return token;
  } catch (error) {
    throw new Error(
      `Vertex MAAS: unable to obtain Google access token (set GOOGLE_OAUTH_ACCESS_TOKEN/VERTEX_ACCESS_TOKEN or login with gcloud). Details: ${String(error)}`,
    );
  }
}
