import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import {
  createOAuthAdapter,
  isOpenAICodexOAuth,
} from "./oauth-adapter.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getOpenAICodexWorkModels } from "./models.js";

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

  const oauth = createOAuthAdapter(openaiCodexOAuth);
  const registerModels = (models: ReturnType<typeof getOpenAICodexWorkModels>) => {
    pi.registerProvider(PROVIDER_ID, {
      name: PROVIDER_NAME,
      baseUrl: CODEX_BASE_URL,
      api: "openai-codex-responses",
      oauth: {
        name: PROVIDER_NAME,
        ...oauth,
      },
      models,
    });
  };

  registerModels(getOpenAICodexWorkModels());
  pi.on("session_start", (_event, ctx) => {
    const sourceModels = ctx.modelRegistry.getModelsOfType("chat", "openai-codex");
    if (sourceModels.length > 0) {
      registerModels(getOpenAICodexWorkModels(sourceModels));
    }
  });
}
