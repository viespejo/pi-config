import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  ALWAYS_ALLOW_TOOLS,
  defaultOptionsForTool,
  isAlwaysAllowedTool,
  shouldBypassPromptForSession,
  supportsSessionAllow,
} from "../gate-policy.ts";

describe("gate-policy", () => {
  it("defines the expected always-allow tools", () => {
    assert.equal(ALWAYS_ALLOW_TOOLS.has("read"), false);
    assert.equal(ALWAYS_ALLOW_TOOLS.has("ls"), true);
    assert.equal(ALWAYS_ALLOW_TOOLS.has("grep"), true);
    assert.equal(ALWAYS_ALLOW_TOOLS.has("find"), true);
    assert.equal(ALWAYS_ALLOW_TOOLS.has("write"), false);
  });

  it("detects always-allow tool names", () => {
    assert.equal(isAlwaysAllowedTool("find"), true);
    assert.equal(isAlwaysAllowedTool("read"), false);
    assert.equal(isAlwaysAllowedTool("edit"), false);
  });

  it("uses bash options with no session persistence", () => {
    assert.deepEqual(defaultOptionsForTool("bash"), ["Run once", "Block"]);
    assert.deepEqual(defaultOptionsForTool("bash", { highRiskBash: true }), [
      "Run high-risk once",
      "Block",
    ]);
  });

  it("uses tool-specific options for read and session options for write", () => {
    assert.deepEqual(defaultOptionsForTool("read"), ["Read once", "Block"]);
    assert.deepEqual(defaultOptionsForTool("write"), [
      "Yes",
      "Yes, always this session",
      "No",
    ]);
  });

  it("does not allow session persistence for bash/read", () => {
    assert.equal(supportsSessionAllow("bash"), false);
    assert.equal(supportsSessionAllow("read"), false);
    assert.equal(supportsSessionAllow("write"), true);
  });

  it("only bypasses prompt for tools present in session allow-list", () => {
    const sessionAllow = new Set<string>(["write"]);
    assert.equal(shouldBypassPromptForSession("write", sessionAllow), true);
    assert.equal(shouldBypassPromptForSession("edit", sessionAllow), false);
    assert.equal(shouldBypassPromptForSession("bash", sessionAllow), false);
  });
});
