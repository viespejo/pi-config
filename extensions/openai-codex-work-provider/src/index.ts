import * as oauth from "@earendil-works/pi-ai/oauth";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
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
  const openaiCodexOAuth = (oauth as Record<string, unknown>).openaiCodexOAuth;
  if (!isOpenAICodexOAuth(openaiCodexOAuth)) {
    throw new Error(
      "OpenAI Codex Work requires Pi's managed OAuth export. Run npm run pi:patch:local for the repository Pi or npm run pi:patch:global for the global Pi installation.",
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
