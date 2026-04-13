import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import permissionGateExtension from "../src/index.ts";

type Handler = (event: any, ctx: any) => any | Promise<any>;

function setupExtension() {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(event: string, fn: Handler) {
      const arr = handlers.get(event) ?? [];
      arr.push(fn);
      handlers.set(event, arr);
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

  return { emit };
}

function makeUI(params: {
  selectAnswers?: string[];
  inputAnswer?: string;
  throwOnSelect?: boolean;
  throwOnInput?: boolean;
}) {
  const {
    selectAnswers = [],
    inputAnswer,
    throwOnSelect = false,
    throwOnInput = false,
  } = params;

  const prompts: string[] = [];
  const selectCalls: Array<{ prompt: string; options: string[] }> = [];
  let customCalls = 0;

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
      },
      notify() {},
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
    assert.match(ui.prompts[1]!, /(Diff viewed|Preview unavailable)/);
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
