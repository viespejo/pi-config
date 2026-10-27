import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("loads Pi's stored catalog before session_start and tolerates unavailable storage", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-work-models-"));
  const previousDirectory = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    const baseline = getOpenAICodexWorkModels();
    const existing = baseline[0];
    assert.ok(existing);
    const storedModel = { ...terraModel, id: "catalog-only-model" };
    writeFileSync(join(directory, "models-store.json"), JSON.stringify({
      "openai-codex": {
        models: [storedModel, { ...terraModel, id: existing.id, contextWindow: 600000 }],
      },
    }));
    const models = getOpenAICodexWorkModels();
    assert.ok(models.some((model) => model.id === storedModel.id));
    assert.equal(models.filter((model) => model.id === existing.id).length, 1);
    assert.equal(models.find((model) => model.id === existing.id)?.contextWindow, 600000);
    writeFileSync(join(directory, "models-store.json"), "invalid JSON");
    assert.deepEqual(getOpenAICodexWorkModels(), baseline);
  } finally {
    if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDirectory;
    rmSync(directory, { recursive: true, force: true });
  }
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
