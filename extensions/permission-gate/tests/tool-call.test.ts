import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import permissionGateExtension from "../src/index.ts";
import {
  APPROVAL_OPTION_NO,
  APPROVAL_OPTION_REVIEW_NVIM,
  APPROVAL_OPTION_VIEW_DIFF,
  APPROVAL_OPTION_YES,
  APPROVAL_OPTION_YES_SESSION,
  REVIEW_OPTION_APPLY,
  REVIEW_OPTION_BACK,
} from "../src/prompt-messages.ts";
import { clearPermissionStateCache } from "../src/permission-rules.ts";

type Handler = (event: any, ctx: any) => any | Promise<any>;

type CommandDef = {
  description?: string;
  handler: (args: string, ctx: any) => Promise<void>;
};

function setupExtension() {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, CommandDef>();
  const userMessages: Array<{ message: string; options?: unknown }> = [];

  const pi = {
    on(event: string, fn: Handler) {
      const arr = handlers.get(event) ?? [];
      arr.push(fn);
      handlers.set(event, arr);
    },
    registerCommand(name: string, options: CommandDef) {
      commands.set(name, options);
    },
    sendUserMessage(message: string, options?: unknown) {
      userMessages.push({ message, options });
    },
  } as any;

  permissionGateExtension(pi);

  async function emit(eventName: string, event: any, ctx: any) {
    const arr = handlers.get(eventName) ?? [];
    let last: any;
    for (const fn of arr) {
      last = await fn(event, ctx);
    }
    return last;
  }

  async function runCommand(name: string, args: string, ctx: any) {
    const command = commands.get(name);
    if (!command) throw new Error(`Command not found: ${name}`);
    await command.handler(args, ctx);
  }

  return {
    emit,
    runCommand,
    hasCommand(name: string) {
      return commands.has(name);
    },
    get userMessages() {
      return userMessages;
    },
  };
}

function makeUI(params: {
  selectAnswers?: string[];
  inputAnswers?: string[];
  throwOnSelect?: boolean;
  throwOnInput?: boolean;
  throwOnCustom?: boolean;
  throwOnNotify?: boolean;
}) {
  const {
    selectAnswers = [],
    inputAnswers = [],
    throwOnSelect = false,
    throwOnInput = false,
    throwOnCustom = false,
    throwOnNotify = false,
  } = params;

  const prompts: string[] = [];
  const selectCalls: Array<{ prompt: string; options: string[] }> = [];
  const inputCalls: Array<{ label: string; placeholder?: string }> = [];
  const notifications: Array<{ message: string; level?: "info" | "warning" | "error" }> = [];
  let customCalls = 0;
  let notifyCalls = 0;

  return {
    ui: {
      async select(prompt: string, options: string[]) {
        if (throwOnSelect) throw new Error("select failed");
        prompts.push(prompt);
        selectCalls.push({ prompt, options });
        return selectAnswers.shift() ?? "No";
      },
      async input(label: string, placeholder?: string) {
        if (throwOnInput) throw new Error("input failed");
        inputCalls.push({ label, placeholder });
        return inputAnswers.shift() ?? "";
      },
      async custom() {
        customCalls++;
        if (throwOnCustom) throw new Error("custom failed");
      },
      notify(message: string, level?: "info" | "warning" | "error") {
        notifyCalls++;
        notifications.push({ message, level });
        if (throwOnNotify) throw new Error("notify failed");
      },
    },
    get prompts() {
      return prompts;
    },
    get selectCalls() {
      return selectCalls;
    },
    get inputCalls() {
      return inputCalls;
    },
    get notifications() {
      return notifications;
    },
    get customCalls() {
      return customCalls;
    },
    get notifyCalls() {
      return notifyCalls;
    },
  };
}

async function writeJson(path: string, value: unknown) {
  await fs.mkdir(nodePath.dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(value, null, 2), "utf-8");
}

describe("permission-gate tool_call", () => {
  it("bypasses prompt for always-allow tools", async () => {
    const gate = setupExtension();
    const ui = makeUI({ selectAnswers: ["No"] });

    const res = await gate.emit(
      "tool_call",
      { toolName: "read", input: { path: "a.txt" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    assert.equal(res, undefined);
    assert.equal(ui.selectCalls.length, 0);
  });

  it("hard-deny blocks bash immediately without approval path", async () => {
    clearPermissionStateCache();
    const gate = setupExtension();
    const ui = makeUI({ selectAnswers: ["Run once"], inputAnswers: ["RUN"] });

    const res = await gate.emit(
      "tool_call",
      { toolName: "bash", input: { command: "rm -rf /" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    assert.equal(res?.block, true);
    assert.match(String(res?.reason), /hard-deny/i);
    assert.equal(ui.selectCalls.length, 0);
    assert.equal(ui.inputCalls.length, 0);
  });

  it("uses local settings to fully replace global permissions", async () => {
    clearPermissionStateCache();
    const oldHome = process.env.HOME;
    const home = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-home-"));
    const cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-cwd-"));
    process.env.HOME = home;

    try {
      await writeJson(nodePath.join(home, ".pi", "settings.json"), {
        permissionGate: {
          permissions: {
            deny: ["Bash(echo *)"],
          },
        },
      });

      await writeJson(nodePath.join(cwd, ".pi", "settings.json"), {
        permissionGate: {
          permissions: {
            ask: ["Bash(echo *)"],
          },
        },
      });

      clearPermissionStateCache(cwd);
      const gate = setupExtension();
      const ui = makeUI({ selectAnswers: ["Run once"] });

      const res = await gate.emit(
        "tool_call",
        { toolName: "bash", input: { command: "echo local override" } },
        { hasUI: true, ui: ui.ui, cwd },
      );

      assert.equal(res, undefined);
      assert.equal(ui.selectCalls.length, 1);
      assert.deepEqual(ui.selectCalls[0]!.options, ["Run once", "Block"]);
    } finally {
      process.env.HOME = oldHome;
      clearPermissionStateCache();
    }
  });

  it("enforces deny > ask > allow precedence", async () => {
    clearPermissionStateCache();
    const cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-precedence-"));
    await writeJson(nodePath.join(cwd, ".pi", "settings.json"), {
      permissionGate: {
        permissions: {
          deny: ["Bash(git *)"],
          ask: ["Bash(git *)"],
          allow: ["Bash(git *)"],
        },
      },
    });

    const gate = setupExtension();
    const ui = makeUI({ selectAnswers: ["Run once"] });
    const res = await gate.emit(
      "tool_call",
      { toolName: "bash", input: { command: "git status" } },
      { hasUI: true, ui: ui.ui, cwd },
    );

    assert.equal(res?.block, true);
    assert.match(String(res?.reason), /Denied by configured rule/i);
    assert.equal(ui.selectCalls.length, 0);
  });

  it("ask rule uses simple one-step confirmation when not high-risk", async () => {
    clearPermissionStateCache();
    const cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-ask-"));
    await writeJson(nodePath.join(cwd, ".pi", "settings.json"), {
      permissionGate: {
        permissions: {
          ask: ["Bash(echo *)"],
        },
      },
    });

    const gate = setupExtension();
    const ui = makeUI({ selectAnswers: ["Run once"] });

    const res = await gate.emit(
      "tool_call",
      { toolName: "bash", input: { command: "echo safe" } },
      { hasUI: true, ui: ui.ui, cwd },
    );

    assert.equal(res, undefined);
    assert.equal(ui.selectCalls.length, 1);
    assert.equal(ui.inputCalls.length, 0);
    assert.match(ui.prompts[0]!, /Run this command once\?/i);
  });

  it("high-risk bash requires typed RUN confirmation", async () => {
    clearPermissionStateCache();
    const gate = setupExtension();
    const ui = makeUI({
      selectAnswers: ["Run high-risk once"],
      inputAnswers: ["RUN"],
    });

    const res = await gate.emit(
      "tool_call",
      { toolName: "bash", input: { command: "sudo echo hi" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    assert.equal(res, undefined);
    assert.equal(ui.selectCalls.length, 1);
    assert.deepEqual(ui.selectCalls[0]!.options, ["Run high-risk once", "Block"]);
    assert.equal(ui.inputCalls.length, 1);
    assert.equal(ui.inputCalls[0]!.label, "Type RUN to confirm");
  });

  it("blocks when high-risk typed confirmation is not RUN/run", async () => {
    clearPermissionStateCache();
    const gate = setupExtension();
    const ui = makeUI({
      selectAnswers: ["Run high-risk once"],
      inputAnswers: ["yes"],
    });

    const res = await gate.emit(
      "tool_call",
      { toolName: "bash", input: { command: "sudo echo hi" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    assert.equal(res?.block, true);
    assert.match(String(res?.reason), /high-risk confirmation failed/i);
  });

  it("allow rule does not bypass high-risk confirmation", async () => {
    clearPermissionStateCache();
    const cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-allow-risk-"));
    await writeJson(nodePath.join(cwd, ".pi", "settings.json"), {
      permissionGate: {
        permissions: {
          allow: ["Bash(sudo *)"],
        },
      },
    });

    const gate = setupExtension();
    const ui = makeUI({
      selectAnswers: ["Run high-risk once"],
      inputAnswers: ["run"],
    });

    const res = await gate.emit(
      "tool_call",
      { toolName: "bash", input: { command: "sudo ls" } },
      { hasUI: true, ui: ui.ui, cwd },
    );

    assert.equal(res, undefined);
    assert.equal(ui.selectCalls.length, 1);
    assert.equal(ui.inputCalls.length, 1);
  });

  it("matches composed bash commands by segment", async () => {
    clearPermissionStateCache();
    const cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-segment-"));
    await writeJson(nodePath.join(cwd, ".pi", "settings.json"), {
      permissionGate: {
        permissions: {
          deny: ["Bash(git push *)"],
        },
      },
    });

    const gate = setupExtension();
    const ui = makeUI({ selectAnswers: ["Run once"] });
    const res = await gate.emit(
      "tool_call",
      { toolName: "bash", input: { command: "echo ok && git push origin main" } },
      { hasUI: true, ui: ui.ui, cwd },
    );

    assert.equal(res?.block, true);
    assert.match(String(res?.reason), /Denied by configured rule/i);
    assert.equal(ui.selectCalls.length, 0);
  });

  it("registers /pgate and executes status/test/reload/clear-session", async () => {
    clearPermissionStateCache();
    const gate = setupExtension();
    assert.equal(gate.hasCommand("pgate"), true);

    const cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-command-"));
    await writeJson(nodePath.join(cwd, ".pi", "settings.json"), {
      permissionGate: {
        permissions: {
          ask: ["Bash(git push *)"],
        },
      },
    });

    const ui = makeUI({});
    const cmdCtx = { cwd, ui: ui.ui };

    await gate.runCommand("pgate", "status", cmdCtx);
    await gate.runCommand("pgate", "test Bash(git push origin main)", cmdCtx);
    await gate.runCommand("pgate", "reload", cmdCtx);
    await gate.runCommand("pgate", "clear-session", cmdCtx);

    assert.equal(ui.notifications.length, 4);
    assert.match(ui.notifications[0]!.message, /permission-gate status/i);
    assert.match(ui.notifications[1]!.message, /pgate test => action=ask/i);
    assert.match(ui.notifications[2]!.message, /permission-gate reloaded/i);
    assert.match(ui.notifications[3]!.message, /session allow-list cleared/i);
  });

  it("/pgate reload keeps session allow-list, /pgate clear-session clears it", async () => {
    clearPermissionStateCache();
    const gate = setupExtension();
    const ui = makeUI({
      selectAnswers: ["Yes, always this session", "Yes"],
    });

    const first = await gate.emit(
      "tool_call",
      { toolName: "write", input: { path: "a", content: "b" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );
    assert.equal(first, undefined);
    assert.equal(ui.selectCalls.length, 1);

    await gate.runCommand("pgate", "reload", { cwd: process.cwd(), ui: ui.ui });

    const second = await gate.emit(
      "tool_call",
      { toolName: "write", input: { path: "a", content: "c" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );
    assert.equal(second, undefined);
    assert.equal(ui.selectCalls.length, 1);

    await gate.runCommand("pgate", "clear-session", { cwd: process.cwd(), ui: ui.ui });

    const third = await gate.emit(
      "tool_call",
      { toolName: "write", input: { path: "a", content: "d" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );
    assert.equal(third, undefined);
    assert.equal(ui.selectCalls.length, 2);
  });

  it("keeps existing write diff preview flow unchanged", async () => {
    const gate = setupExtension();
    const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-flow-write-"));
    const ui = makeUI({ selectAnswers: ["View diff", "Yes"] });

    const res = await gate.emit(
      "tool_call",
      {
        toolName: "write",
        input: { path: "new.txt", content: "hello\nworld\n" },
      },
      { hasUI: true, ui: ui.ui, cwd: tmp },
    );

    assert.equal(res, undefined);
    assert.equal(ui.selectCalls.length, 2);
    assert.deepEqual(ui.selectCalls[0]!.options, [
      APPROVAL_OPTION_YES,
      APPROVAL_OPTION_VIEW_DIFF,
      APPROVAL_OPTION_REVIEW_NVIM,
      APPROVAL_OPTION_YES_SESSION,
      APPROVAL_OPTION_NO,
    ]);
  });

  it("keeps existing edit review-in-neovim flow unchanged", async () => {
    const gate = setupExtension();
    const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-nvim-back-flow-"));
    const ui = makeUI({
      selectAnswers: ["Review in Neovim", "Back to approval menu", "No"],
    });

    const res = await gate.emit(
      "tool_call",
      {
        toolName: "write",
        input: { path: "file.txt", content: "hello\n" },
      },
      {
        hasUI: true,
        ui: ui.ui,
        cwd: tmp,
        neovimReviewAdapters: {
          spawnNvim: async (args: string[]) => {
            await fs.writeFile(args[2]!, "hello reviewed\n", "utf-8");
            return { ok: true };
          },
        },
      },
    );

    assert.equal(res?.block, true);
    assert.deepEqual(ui.selectCalls[1]!.options, [REVIEW_OPTION_APPLY, REVIEW_OPTION_BACK]);
  });

  it("blocks if no UI is available for non-auto-allowed tools", async () => {
    const gate = setupExtension();
    const res = await gate.emit(
      "tool_call",
      { toolName: "write", input: { path: "x", content: "y" } },
      { hasUI: false },
    );

    assert.equal(res?.block, true);
    assert.match(String(res?.reason), /no UI available/i);
  });

  it("warms up once on session_start and notify errors are best-effort", async () => {
    const gate = setupExtension();
    const ui = makeUI({ throwOnNotify: true });

    await gate.emit("session_start", {}, { hasUI: true, ui: ui.ui });
    await gate.emit("session_start", {}, { hasUI: true, ui: ui.ui });

    assert.ok(ui.notifyCalls <= 1);
  });
});
