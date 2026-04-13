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

type Handler = (event: any, ctx: any) => any | Promise<any>;

function setupExtension() {
  const handlers = new Map<string, Handler[]>();
  const userMessages: Array<{ message: string; options?: unknown }> = [];
  const pi = {
    on(event: string, fn: Handler) {
      const arr = handlers.get(event) ?? [];
      arr.push(fn);
      handlers.set(event, arr);
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

  return {
    emit,
    get userMessages() {
      return userMessages;
    },
  };
}

function makeUI(params: {
  selectAnswers?: string[];
  inputAnswer?: string;
  throwOnSelect?: boolean;
  throwOnInput?: boolean;
  throwOnCustom?: boolean;
  throwOnNotify?: boolean;
}) {
  const {
    selectAnswers = [],
    inputAnswer,
    throwOnSelect = false,
    throwOnInput = false,
    throwOnCustom = false,
    throwOnNotify = false,
  } = params;

  const prompts: string[] = [];
  const selectCalls: Array<{ prompt: string; options: string[] }> = [];
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
      async input(_label: string, _placeholder?: string) {
        if (throwOnInput) throw new Error("input failed");
        return inputAnswer ?? "";
      },
      async custom() {
        customCalls++;
        if (throwOnCustom) throw new Error("custom failed");
      },
      notify() {
        notifyCalls++;
        if (throwOnNotify) throw new Error("notify failed");
      },
    },
    get prompts() {
      return prompts;
    },
    get selectCalls() {
      return selectCalls;
    },
    get customCalls() {
      return customCalls;
    },
    get notifyCalls() {
      return notifyCalls;
    },
  };
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

  it("blocks if no UI is available", async () => {
    const gate = setupExtension();
    const res = await gate.emit(
      "tool_call",
      { toolName: "write", input: { path: "x", content: "y" } },
      { hasUI: false },
    );

    assert.equal(res?.block, true);
    assert.match(String(res?.reason), /no UI available/i);
  });

  it("returns blocked reason from ui.input when user denies", async () => {
    const gate = setupExtension();
    const ui = makeUI({ selectAnswers: ["No"], inputAnswer: "no quiero" });

    const res = await gate.emit(
      "tool_call",
      { toolName: "bash", input: { command: "rm -rf /tmp/x" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    assert.equal(res?.block, true);
    assert.match(String(res?.reason), /no quiero/);
  });

  it("survives input failures and still blocks denied calls", async () => {
    const gate = setupExtension();
    const ui = makeUI({ selectAnswers: ["No"], throwOnInput: true });

    const res = await gate.emit(
      "tool_call",
      { toolName: "bash", input: { command: "echo test" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    assert.equal(res?.block, true);
    assert.equal(res?.reason, "Blocked by user");
  });

  it("supports 'always this session' for non-bash tools", async () => {
    const gate = setupExtension();
    const ui = makeUI({ selectAnswers: ["Yes, always this session"] });

    const first = await gate.emit(
      "tool_call",
      { toolName: "write", input: { path: "a", content: "b" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    const second = await gate.emit(
      "tool_call",
      { toolName: "write", input: { path: "a", content: "c" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    assert.equal(first, undefined);
    assert.equal(second, undefined);
    assert.equal(ui.selectCalls.length, 1);
  });

  it("handles write diff preview flow for new files", async () => {
    const gate = setupExtension();
    const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-flow-write-"));
    const ui = makeUI({ selectAnswers: ["View diff", "Yes"] });

    const res = await gate.emit(
      "tool_call",
      {
        toolName: "write",
        input: { path: "new.txt", content: "hola\nmundo\n" },
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
    assert.match(
      ui.prompts[1]!,
      /(Diff viewed \(write:create\)|Preview unavailable \(write:local\)|Preview unavailable due to an unexpected error)/,
    );
  });

  it("handles edit diff preview flow", async () => {
    const gate = setupExtension();
    const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-flow-edit-"));
    const relPath = "file.txt";
    await fs.writeFile(nodePath.join(tmp, relPath), "uno\ndos\n", "utf-8");
    const ui = makeUI({ selectAnswers: ["View diff", "Yes"] });

    const res = await gate.emit(
      "tool_call",
      {
        toolName: "edit",
        input: {
          path: relPath,
          edits: [{ oldText: "dos", newText: "tres" }],
        },
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
    assert.match(ui.prompts[1]!, /(Diff viewed|Preview unavailable)/);
  });

  it("returns to approval menu when neovim review has no changes", async () => {
    const gate = setupExtension();
    const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-nvim-no-change-flow-"));
    const ui = makeUI({ selectAnswers: ["Review in Neovim", "Yes"] });

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
          spawnNvim: async () => ({ ok: true }),
        },
      },
    );

    assert.equal(res, undefined);
    assert.equal(ui.selectCalls.length, 2);
    assert.deepEqual(ui.selectCalls[1]!.options, [
      APPROVAL_OPTION_YES,
      APPROVAL_OPTION_VIEW_DIFF,
      APPROVAL_OPTION_REVIEW_NVIM,
      APPROVAL_OPTION_YES_SESSION,
      APPROVAL_OPTION_NO,
    ]);
  });

  it("shows changed-content intermediate prompt and supports back-to-menu", async () => {
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
    assert.equal(ui.selectCalls.length, 3);
    assert.deepEqual(ui.selectCalls[1]!.options, [REVIEW_OPTION_APPLY, REVIEW_OPTION_BACK]);
    assert.deepEqual(ui.selectCalls[2]!.options, [
      APPROVAL_OPTION_YES,
      APPROVAL_OPTION_VIEW_DIFF,
      APPROVAL_OPTION_REVIEW_NVIM,
      APPROVAL_OPTION_YES_SESSION,
      APPROVAL_OPTION_NO,
    ]);
  });

  it("applies reviewed version and blocks original write call", async () => {
    const gate = setupExtension();
    const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-nvim-apply-flow-"));
    const ui = makeUI({
      selectAnswers: ["Review in Neovim", "Apply reviewed version"],
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

    const persisted = await fs.readFile(nodePath.join(tmp, "file.txt"), "utf-8");
    assert.equal(persisted, "hello reviewed\n");
    assert.equal(res?.block, true);
    assert.match(String(res?.reason), /reviewed version was applied manually/i);
    assert.equal(gate.userMessages.length, 0);
  });

  it("sends steer message when applied reviewed version contains ai: comments", async () => {
    const gate = setupExtension();
    const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-nvim-apply-ai-flow-"));
    const ui = makeUI({
      selectAnswers: ["Review in Neovim", "Apply reviewed version"],
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
            await fs.writeFile(args[2]!, "hello\n// ai: rewrite this block\n", "utf-8");
            return { ok: true };
          },
        },
      },
    );

    const persisted = await fs.readFile(nodePath.join(tmp, "file.txt"), "utf-8");
    assert.equal(persisted, "hello\n// ai: rewrite this block\n");
    assert.equal(res?.block, true);
    assert.match(String(res?.reason), /ai-guided reviewed version/i);
    assert.equal(gate.userMessages.length, 1);
    assert.match(gate.userMessages[0]!.message, /Re-read the file, follow every ai: instruction/i);
    assert.deepEqual(gate.userMessages[0]!.options, { deliverAs: "steer" });
  });

  it("keeps approval flow when neovim is unavailable", async () => {
    const gate = setupExtension();
    const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-nvim-unavailable-flow-"));
    const ui = makeUI({ selectAnswers: ["Review in Neovim", "No"] });

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
          spawnNvim: async () => ({ ok: false, reason: "nvim not found" }),
        },
      },
    );

    assert.equal(res?.block, true);
    assert.equal(ui.selectCalls.length, 2);
    assert.match(ui.prompts[1]!, /Review in Neovim unavailable: nvim not found/);
  });

  it("does not persist session allow-list for bash", async () => {
    const gate = setupExtension();
    const ui = makeUI({ selectAnswers: ["Yes", "Yes"] });

    const first = await gate.emit(
      "tool_call",
      { toolName: "bash", input: { command: "echo first" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );
    const second = await gate.emit(
      "tool_call",
      { toolName: "bash", input: { command: "echo second" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    assert.equal(first, undefined);
    assert.equal(second, undefined);
    assert.equal(ui.selectCalls.length, 2);
    assert.deepEqual(ui.selectCalls[0]!.options, ["Yes", "No"]);
    assert.deepEqual(ui.selectCalls[1]!.options, ["Yes", "No"]);
  });

  it("shows metadata fallback for write when content is missing", async () => {
    const gate = setupExtension();
    const ui = makeUI({ selectAnswers: ["View diff", "No"] });

    const res = await gate.emit(
      "tool_call",
      { toolName: "write", input: { path: "file.txt" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    assert.equal(res?.block, true);
    assert.equal(ui.selectCalls.length, 2);
    assert.match(ui.prompts[1]!, /missing content input/i);
    assert.match(ui.prompts[1]!, /Note: detailed preview unavailable/i);
  });

  it("shows metadata fallback for edit when path/edits are missing", async () => {
    const gate = setupExtension();
    const ui = makeUI({ selectAnswers: ["View diff", "No"] });

    const res = await gate.emit(
      "tool_call",
      { toolName: "edit", input: {} },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    assert.equal(res?.block, true);
    assert.equal(ui.selectCalls.length, 2);
    assert.match(ui.prompts[1]!, /missing path\/edits input/i);
  });

  it("keeps flow stable when diff view rendering fails", async () => {
    const gate = setupExtension();
    const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-custom-fail-"));
    const ui = makeUI({ selectAnswers: ["View diff", "No"], throwOnCustom: true });

    const res = await gate.emit(
      "tool_call",
      {
        toolName: "write",
        input: { path: "render-error.txt", content: "new content\n" },
      },
      { hasUI: true, ui: ui.ui, cwd: tmp },
    );

    assert.equal(res?.block, true);
    assert.equal(ui.selectCalls.length, 2);
    assert.match(ui.prompts[1]!, /unexpected error/i);
  });

  it("warms up once on session_start and notify errors are best-effort", async () => {
    const gate = setupExtension();
    const ui = makeUI({ throwOnNotify: true });

    await gate.emit("session_start", {}, { hasUI: true, ui: ui.ui });
    await gate.emit("session_start", {}, { hasUI: true, ui: ui.ui });

    assert.ok(ui.notifyCalls <= 1);
  });

  it("blocks when ui.select throws", async () => {
    const gate = setupExtension();
    const ui = makeUI({ throwOnSelect: true });

    const res = await gate.emit(
      "tool_call",
      { toolName: "write", input: { path: "x", content: "y" } },
      { hasUI: true, ui: ui.ui, cwd: process.cwd() },
    );

    assert.equal(res?.block, true);
    assert.match(String(res?.reason), /ui\.select failed/i);
  });
});
