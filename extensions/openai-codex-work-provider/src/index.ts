import {
  builtinProviders,
  getBuiltinModels,
} from "@earendil-works/pi-ai/providers/all";
import {
  createOAuthAdapter,
  isOpenAICodexOAuth,
} from "./oauth-adapter.js";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "openai-codex-work";
const PROVIDER_NAME = "ChatGPT Plus/Pro (Codex Work Subscription)";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

export default function registerOpenAICodexWorkProvider(pi: ExtensionAPI): void {
  const openaiCodexOAuth = builtinProviders().find(
    (provider) => provider.id === "openai-codex",
  )?.auth.oauth;
  if (!isOpenAICodexOAuth(openaiCodexOAuth)) {
    throw new Error(
      "OpenAI Codex Work requires Pi's built-in OpenAI Codex OAuth support. Use Pi 0.84.4 or later.",
    );
  }

  const sourceModels = getBuiltinModels("openai-codex");
  const models = sourceModels.map((sourceModel): ProviderModelConfig => {
    const { provider: _provider, ...model } = structuredClone(sourceModel);
    return { ...model, name: `${model.name} (Work)` };
  });

  pi.registerProvider(PROVIDER_ID, {
    name: PROVIDER_NAME,
    baseUrl: CODEX_BASE_URL,
    api: "openai-codex-responses",
    oauth: {
      name: PROVIDER_NAME,
      ...createOAuthAdapter(openaiCodexOAuth),
    },
    models,
  });
}
