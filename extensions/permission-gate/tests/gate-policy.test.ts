import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  ALWAYS_ALLOW_TOOLS,
  defaultOptionsForTool,
  isAlwaysAllowedTool,
  shouldBypassPromptForSession,
  supportsSessionAllow,
} from "../src/gate-policy.ts";

describe("gate-policy", () => {
  it("defines the expected always-allow tools", () => {
    assert.equal(ALWAYS_ALLOW_TOOLS.has("read"), true);
    assert.equal(ALWAYS_ALLOW_TOOLS.has("ls"), true);
    assert.equal(ALWAYS_ALLOW_TOOLS.has("grep"), true);
    assert.equal(ALWAYS_ALLOW_TOOLS.has("find"), true);
    assert.equal(ALWAYS_ALLOW_TOOLS.has("write"), false);
  });

  it("detects always-allow tool names", () => {
    assert.equal(isAlwaysAllowedTool("read"), true);
    assert.equal(isAlwaysAllowedTool("edit"), false);
  });

  it("uses strict options for bash", () => {
    assert.deepEqual(defaultOptionsForTool("bash"), ["Yes", "No"]);
  });

  it("uses session options for non-bash tools", () => {
    assert.deepEqual(defaultOptionsForTool("write"), [
      "Yes",
      "Yes, always this session",
      "No",
    ]);
  });

  it("does not allow session persistence for bash", () => {
    assert.equal(supportsSessionAllow("bash"), false);
    assert.equal(supportsSessionAllow("write"), true);
  });

  it("only bypasses prompt for tools present in session allow-list", () => {
    const sessionAllow = new Set<string>(["write"]);
    assert.equal(shouldBypassPromptForSession("write", sessionAllow), true);
    assert.equal(shouldBypassPromptForSession("edit", sessionAllow), false);
    assert.equal(shouldBypassPromptForSession("bash", sessionAllow), false);
  });
});
