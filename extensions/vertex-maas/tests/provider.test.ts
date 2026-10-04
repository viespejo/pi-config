import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeContext,
  type Api,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  registerApiProvider,
  resetApiProviders,
} from "@earendil-works/pi-ai/compat";
import type {
  ExtensionAPI,
  ProviderConfig,
} from "@earendil-works/pi-coding-agent";
import registerVertexMaas from "../index.ts";

function emptyStream(): AssistantMessageEventStream {
  return {
    async *[Symbol.asyncIterator]() {
      // The test only needs to trigger lazy provider setup.
    },
  } as unknown as AssistantMessageEventStream;
}

function testModel(): Model<Api> {
  return {
    id: "zai-org/glm-5-maas",
    name: "GLM 5 (Vertex MAAS)",
    api: "openai-completions",
    provider: "google-vertex-maas",
    baseUrl: "https://unused.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 32_768,
  };
}

test("delegates context, scoped credentials, endpoint, and request options", async () => {
  const previousProject = process.env.GOOGLE_CLOUD_PROJECT;
  const previousToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  process.env.GOOGLE_CLOUD_PROJECT = "registration-project";
  delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  resetApiProviders();

  let received:
    | {
        model: Model<Api>;
        context: TranscriptContext;
        options?: SimpleStreamOptions;
      }
    | undefined;
  const delegate = (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ) => {
    received = { model, context, options };
    return emptyStream();
  };
  registerApiProvider(
    {
      api: "openai-completions",
      stream: delegate,
      streamSimple: delegate,
    },
    "vertex-maas-test",
  );

  let providerConfig: ProviderConfig | undefined;
  const pi = {
    registerProvider(_id: string, config: ProviderConfig) {
      providerConfig = config;
    },
  } as ExtensionAPI;

  try {
    registerVertexMaas(pi);
    assert.ok(providerConfig?.streamSimple);

    const context = normalizeContext({
      systemPrompt: "system",
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    });
    const signal = new AbortController().signal;
    const onPayload = async (payload: unknown) => payload;
    const onResponse = async () => {};
    const onProviderStreamEvent = async () => {};

    const stream = providerConfig.streamSimple(testModel(), context, {
      signal,
      env: {
        GOOGLE_CLOUD_PROJECT: "request-project",
        GOOGLE_CLOUD_LOCATION: "europe-west1",
        GOOGLE_OAUTH_ACCESS_TOKEN: "scoped-token",
      },
      headers: { "x-audit": "enabled" },
      onPayload,
      onResponse,
      onProviderStreamEvent,
    });
    const iterator = stream[Symbol.asyncIterator]();
    while (!(await iterator.next()).done) {
      // Trigger and consume the lazy delegate.
    }

    assert.ok(received);
    assert.equal(received.context, context);
    assert.equal(
      received.model.baseUrl,
      "https://aiplatform.googleapis.com/v1/projects/request-project/locations/europe-west1/endpoints/openapi",
    );
    assert.equal(received.options?.apiKey, "scoped-token");
    assert.equal(received.options?.signal, signal);
    assert.deepEqual(received.options?.headers, { "x-audit": "enabled" });
    assert.equal(received.options?.onPayload, onPayload);
    assert.equal(received.options?.onResponse, onResponse);
    assert.equal(received.options?.onProviderStreamEvent, onProviderStreamEvent);
  } finally {
    resetApiProviders();
    if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
    if (previousToken === undefined) delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    else process.env.GOOGLE_OAUTH_ACCESS_TOKEN = previousToken;
  }
});
