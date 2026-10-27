import type { Api, Model } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export function getOpenAICodexWorkModels(
  sourceModels: readonly Model<Api>[] = getBuiltinModels("openai-codex"),
): ProviderModelConfig[] {
  return sourceModels.map((sourceModel): ProviderModelConfig => {
    const { provider: _provider, ...model } = structuredClone(sourceModel);
    return { ...model, name: `${model.name} (Work)` };
  });
}
