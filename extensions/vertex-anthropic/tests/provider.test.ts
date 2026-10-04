import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssistantMessageEventStream,
  normalizeContext,
  type Api,
  type Model,
  type StreamOptions,
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
import registerVertexAnthropic from "../index.ts";

function testModel(): Model<Api> {
  return {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6 (Vertex)",
    api: "google-vertex-anthropic",
    provider: "google-vertex-anthropic",
    baseUrl: "https://global-aiplatform.googleapis.com",
    reasoning: true,
    thinkingLevelMap: { high: "high" },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  };
}

test("delegates normalized context and preserves request options", () => {
  const previousProject = process.env.GOOGLE_CLOUD_PROJECT;
  process.env.GOOGLE_CLOUD_PROJECT = "registration-project";
  resetApiProviders();

  let received:
    | { model: Model<Api>; context: TranscriptContext; options?: StreamOptions }
    | undefined;
  const delegate = (
    model: Model<Api>,
    context: TranscriptContext,
    options?: StreamOptions,
  ) => {
    received = { model, context, options };
    return createAssistantMessageEventStream();
  };
  registerApiProvider(
    {
      api: "anthropic-messages",
      stream: delegate,
      streamSimple: delegate,
    },
    "vertex-anthropic-test",
  );

  let providerConfig: ProviderConfig | undefined;
  const pi = {
    registerProvider(_id: string, config: ProviderConfig) {
      providerConfig = config;
    },
  } as ExtensionAPI;

  try {
    registerVertexAnthropic(pi);
    assert.ok(providerConfig?.streamSimple);

    const context = normalizeContext({
      systemPrompt: "system",
      messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    });
    const signal = new AbortController().signal;
    const fetchFn = async () => new Response(null, { status: 200 });
    const onPayload = async (payload: unknown) => payload;
    const onResponse = async () => {};
    const onProviderStreamEvent = async () => {};

    providerConfig.streamSimple(testModel(), context, {
      reasoning: "high",
      cacheRetention: "long",
      sessionId: "session-1",
      signal,
      fetch: fetchFn,
      env: {
        GOOGLE_CLOUD_PROJECT: "request-project",
        GOOGLE_CLOUD_LOCATION: "europe-west1",
      },
      headers: { "x-audit": "enabled" },
      timeoutMs: 1234,
      maxRetries: 0,
      metadata: { audit: true },
      onPayload,
      onResponse,
      onProviderStreamEvent,
    });

    assert.ok(received);
    assert.equal(received.context, context);
    assert.equal(received.model.api, "anthropic-messages");
    assert.equal(received.options?.signal, signal);
    assert.equal(received.options?.fetch, fetchFn);
    assert.deepEqual(received.options?.env, {
      GOOGLE_CLOUD_PROJECT: "request-project",
      GOOGLE_CLOUD_LOCATION: "europe-west1",
    });
    assert.deepEqual(received.options?.headers, { "x-audit": "enabled" });
    assert.equal(received.options?.timeoutMs, 1234);
    assert.equal(received.options?.maxRetries, 0);
    assert.deepEqual(received.options?.metadata, { audit: true });
    assert.equal(received.options?.onPayload, onPayload);
    assert.equal(received.options?.onResponse, onResponse);
    assert.equal(received.options?.onProviderStreamEvent, onProviderStreamEvent);
    assert.equal((received.options as { thinkingEnabled?: boolean }).thinkingEnabled, true);
    assert.equal((received.options as { effort?: string }).effort, "high");
    assert.equal((received.options as { maxTokens?: number }).maxTokens, 32_000);

    const client = (received.options as { client?: { projectId?: string; region?: string } }).client;
    assert.equal(client?.projectId, "request-project");
    assert.equal(client?.region, "europe-west1");
  } finally {
    resetApiProviders();
    if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
  }
});
