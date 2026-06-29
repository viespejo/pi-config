import { getModels } from "@earendil-works/pi-ai/compat";
import { openaiCodexOAuthProvider } from "@earendil-works/pi-ai/oauth";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "openai-codex-work";
const PROVIDER_NAME = "ChatGPT Plus/Pro (Codex Work Subscription)";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

export default function registerOpenAICodexWorkProvider(pi: ExtensionAPI): void {
  const sourceModels = getModels("openai-codex");
  const models = sourceModels.map(
    (model): ProviderModelConfig => ({
      id: model.id,
      name: `${model.name} (Work)`,
      api: model.api,
      baseUrl: model.baseUrl ?? CODEX_BASE_URL,
      reasoning: model.reasoning,
      thinkingLevelMap: model.thinkingLevelMap,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      headers: model.headers,
      compat: model.compat,
    }),
  );

  pi.registerProvider(PROVIDER_ID, {
    name: PROVIDER_NAME,
    baseUrl: CODEX_BASE_URL,
    api: "openai-codex-responses",
    oauth: {
      name: PROVIDER_NAME,
      login: openaiCodexOAuthProvider.login.bind(openaiCodexOAuthProvider),
      refreshToken: openaiCodexOAuthProvider.refreshToken.bind(openaiCodexOAuthProvider),
      getApiKey: openaiCodexOAuthProvider.getApiKey.bind(openaiCodexOAuthProvider),
    },
    models,
  });
}
