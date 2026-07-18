import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchAllUsages, fetchCodexUsage } from "./core.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function model(provider: string) {
  return { provider, id: `${provider}-quota-model` } as any;
}

function context(models: any[], apiKeys: Record<string, string>) {
  const authCalls: string[] = [];
  const registry = {
    getAvailable: () => models,
    getApiKeyAndHeaders: async (selectedModel: any) => {
      authCalls.push(selectedModel.provider);
      return { ok: true as const, apiKey: apiKeys[selectedModel.provider] };
    },
  };

  return { ctx: { modelRegistry: registry } as any, authCalls };
}

function quotaResponse() {
  return {
    ok: true,
    json: async () => ({
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 3600 },
        secondary_window: { used_percent: 20, limit_window_seconds: 604800 },
      },
      buckets: [
        {
          modelId: "gemini-3-flash-preview",
          tokenType: "REQUESTS",
          remainingFraction: 0.9,
          quotaId: "daily",
          resetTime: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
    }),
  } as Response;
}

test("labels a single seven-day Codex window as Weekly", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      rate_limit: {
        primary_window: {
          used_percent: 25,
          limit_window_seconds: 604800,
          reset_after_seconds: 3600,
        },
      },
    }),
  }) as Response;

  const usage = await fetchCodexUsage("token");
  assert.deepEqual(usage.quotas, [{
    session: 25,
    weekly: undefined,
    sessionLabel: "Weekly",
    weeklyLabel: undefined,
    sessionResetsIn: "1h",
    weeklyResetsIn: undefined,
  }]);
});

test("resolves active runtime auth for every usage provider", async () => {
  const requests: { url: string; authorization: string; body: string }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      authorization: String((init?.headers as Record<string, string>).Authorization),
      body: String(init?.body ?? ""),
    });
    return quotaResponse();
  };

  const { ctx, authCalls } = context(
    [model("anthropic"), model("openai-codex"), model("openai-codex-work"), model("google-gemini-cli")],
    {
      anthropic: "claude-refreshed-token",
      "openai-codex": "codex-refreshed-token",
      "openai-codex-work": "codex-work-refreshed-token",
      "google-gemini-cli": JSON.stringify({ token: "gemini-refreshed-token", projectId: "resolved-project" }),
    },
  );

  const usages = await fetchAllUsages(ctx, false, () => {
    throw new Error("credential access should not be needed");
  });

  assert.deepEqual(authCalls.sort(), ["anthropic", "google-gemini-cli", "openai-codex", "openai-codex-work"]);
  assert.deepEqual(
    requests.map((request) => request.authorization).sort(),
    [
      "Bearer claude-refreshed-token",
      "Bearer codex-refreshed-token",
      "Bearer codex-work-refreshed-token",
      "Bearer gemini-refreshed-token",
    ].sort(),
  );
  const geminiRequest = requests.find((request) => request.url.includes("retrieveUserQuota"));
  assert.ok(geminiRequest);
  assert.match(geminiRequest.url, /retrieveUserQuota/);
  assert.equal(JSON.parse(geminiRequest.body).project, "resolved-project");
  assert.equal(usages.find((usage) => usage.provider === "Gemini")?.error, undefined);
});

test("uses stored Gemini project metadata only when resolved payload omits it", async () => {
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body);
    return quotaResponse();
  };

  const { ctx } = context([model("google-gemini-cli")], {
    "google-gemini-cli": JSON.stringify({ token: "resolved-token" }),
  });
  let readerCalls = 0;
  const usages = await fetchAllUsages(ctx, false, (providerId) => {
    readerCalls++;
    assert.equal(providerId, "google-gemini-cli");
    return { access: "stale-token-must-not-be-used", projectId: "stored-project" };
  });

  assert.equal(readerCalls, 1);
  assert.equal(JSON.parse(requestBody).project, "stored-project");
  assert.equal(usages.find((usage) => usage.provider === "Gemini")?.error, undefined);
});

test("reports unavailable providers without resolving static credentials", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return quotaResponse();
  };

  const { ctx, authCalls } = context([], {});
  const usages = await fetchAllUsages(ctx, false, () => {
    throw new Error("stored credential access should not be attempted");
  });

  assert.equal(fetchCalls, 0);
  assert.equal(authCalls.length, 0);
  assert.equal(usages.length, 4);
  for (const usage of usages) {
    assert.match(usage.error ?? "", /provider unavailable/);
  }
});
