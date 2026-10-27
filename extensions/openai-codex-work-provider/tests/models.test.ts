import assert from "node:assert/strict";
import test from "node:test";

import { getOpenAICodexWorkModels } from "../src/models.ts";

const terraModel = {
  id: "gpt-6.1-terra",
  name: "GPT-6.1 Terra",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  input: ["text", "image"],
  cost: {
    input: 1,
    output: 5,
    cacheRead: 0.05,
    cacheWrite: 1.25,
    tiers: [
      {
        inputTokensAbove: 272000,
        input: 2,
        output: 7.5,
        cacheRead: 0.1,
        cacheWrite: 2.5,
      },
    ],
  },
  contextWindow: 500000,
  maxTokens: 128000,
  thinkingLevelMap: {
    off: "none",
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  compat: {
    supportsOpenAIGrammarTools: true,
    supportsAdditionalTools: true,
    supportsToolSearch: true,
    supportsMidConvoSystemMessages: true,
  },
  inputLimits: {
    images: {
      resize: {
        maxWidth: 2000,
        maxHeight: 2000,
        maxBytes: 4718592,
        jpegQuality: 80,
      },
    },
  },
};

test("copies models from Pi's merged Codex catalog into the Work provider", () => {
  const models = getOpenAICodexWorkModels([terraModel]);

  assert.equal(models.length, 1);
  const { provider: _provider, ...modelWithoutProvider } = terraModel;
  assert.deepEqual(models[0], {
    ...modelWithoutProvider,
    name: "GPT-6.1 Terra (Work)",
  });
});

test("preserves newly added catalog entries without hardcoding model ids", () => {
  const futureModel = {
    ...terraModel,
    id: "gpt-next-terra",
    name: "GPT Next Terra",
  };

  const models = getOpenAICodexWorkModels([terraModel, futureModel]);

  assert.deepEqual(
    models.map((model) => [model.id, model.name]),
    [
      ["gpt-6.1-terra", "GPT-6.1 Terra (Work)"],
      ["gpt-next-terra", "GPT Next Terra (Work)"],
    ],
  );
});
