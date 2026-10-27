import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { getAgentDir, type ProviderModelConfig } from "@earendil-works/pi-coding-agent";

function getStoredCodexModels(): readonly Model<Api>[] {
  try {
    const store = JSON.parse(
      readFileSync(join(getAgentDir(), "models-store.json"), "utf8"),
    ) as Record<string, { models?: Model<Api>[] }>;
    const models = store["openai-codex"]?.models;
    return Array.isArray(models)
      ? models.filter((model) =>
          model && model.provider === "openai-codex" &&
          typeof model.id === "string" &&
          (model.type === undefined || model.type === "chat"),
        )
      : [];
  } catch {
    return [];
  }
}

function getCodexCatalogModels(): readonly Model<Api>[] {
  const models = new Map<string, Model<Api>>(
    getBuiltinModels("openai-codex").map((model) => [model.id, model]),
  );
  for (const model of getStoredCodexModels()) {
    models.set(model.id, model);
  }
  return [...models.values()];
}

export function getOpenAICodexWorkModels(
  sourceModels: readonly Model<Api>[] = getCodexCatalogModels(),
): ProviderModelConfig[] {
  return sourceModels.map((sourceModel): ProviderModelConfig => {
    const { provider: _provider, ...model } = structuredClone(sourceModel);
    return { ...model, name: `${model.name} (Work)` };
  });
}
