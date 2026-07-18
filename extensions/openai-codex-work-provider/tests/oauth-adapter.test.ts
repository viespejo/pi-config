import assert from "node:assert/strict";
import test from "node:test";

import {
  createOAuthAdapter,
  type OpenAICodexOAuth,
} from "../src/oauth-adapter.ts";

const credentials = {
  access: "access-token",
  refresh: "refresh-token",
  expires: 123,
};

test("adapts Pi login notifications and prompts", async () => {
  const events: string[] = [];
  const oauth: OpenAICodexOAuth = {
    async login(interaction) {
      interaction.notify({
        type: "auth_url",
        url: "https://example.test/login",
        instructions: "Sign in",
      });
      interaction.notify({
        type: "progress",
        message: "Waiting",
      });
      assert.equal(
        await interaction.prompt({
          type: "select",
          message: "Method",
          options: [{ id: "browser", label: "Browser" }],
        }),
        "browser",
      );
      return credentials;
    },
    async refresh(credential) {
      return credential;
    },
    async toAuth(credential) {
      return { apiKey: credential.access };
    },
  };

  const adapter = createOAuthAdapter(oauth);
  assert.deepEqual(
    await adapter.login({
      onAuth(info) {
        events.push(`${info.url}:${info.instructions}`);
      },
      onDeviceCode() {},
      async onPrompt() {
        return "";
      },
      onProgress(message) {
        events.push(message);
      },
      async onSelect() {
        return "browser";
      },
    }),
    credentials,
  );
  assert.deepEqual(events, ["https://example.test/login:Sign in", "Waiting"]);
});

test("delegates refresh and resolves the preserved access token", async () => {
  let refreshed: unknown;
  const oauth: OpenAICodexOAuth = {
    async login() {
      return credentials;
    },
    async refresh(credential) {
      refreshed = credential;
      return { ...credential, access: "refreshed-token" };
    },
    async toAuth(credential) {
      return { apiKey: credential.access };
    },
  };

  const adapter = createOAuthAdapter(oauth);
  assert.deepEqual(await adapter.refreshToken(credentials), {
    ...credentials,
    access: "refreshed-token",
  });
  assert.equal(refreshed, credentials);
  assert.equal(adapter.getApiKey(credentials), "access-token");
});
