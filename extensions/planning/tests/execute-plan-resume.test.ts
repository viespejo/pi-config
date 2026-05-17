import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import { executePlanFlow } from "../lib/execute-plan.ts";
import type { PlanInfo } from "../lib/types.ts";

function mkPlan(tmpDir: string): PlanInfo {
  return {
    filename: "04-03-apply-execution-log-adaptation.md",
    path: path.join(tmpDir, "04-03-apply-execution-log-adaptation.md"),
    slug: "04-03-apply-execution-log-adaptation",
    date: "2026-05-17",
    title: "Apply Execution Log Adaptation",
    directory: tmpDir,
    status: "pending",
    dependencies: [],
    dependents: [],
  };
}

function mkPlanContent(): string {
  return `<tasks>\n<task id="task-1"><name>A</name></task>\n<task id="task-2"><name>B</name></task>\n</tasks>`;
}

test("executePlanFlow aborts before execution when resume is declined", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "planning-resume-"));
  const plan = mkPlan(tmpDir);
  const logPath = path.join(tmpDir, `${plan.slug}.execution.jsonl`);
  await fs.writeFile(logPath, "", "utf-8");

  const notifications: Array<[string, string]> = [];
  const selects: Array<[string, string[]]> = [];
  const calls: string[] = [];

  const ctx = {
    ui: {
      notify: (msg: string, level: string) => notifications.push([msg, level]),
      select: async (question: string, options: string[]) => {
        selects.push([question, options]);
        return "no";
      },
      setWidget: () => {},
    },
    sessionManager: { getSessionFile: () => "s-1" },
  } as any;

  const pi = {
    setSessionName: () => {},
    getActiveTools: () => ["read", "bash", "edit", "write"],
    setActiveTools: () => {},
    appendEntry: () => {
      calls.push("appendEntry");
    },
    sendUserMessage: () => {
      calls.push("sendUserMessage");
    },
  } as any;

  const planService = {
    getPlansPath: () => tmpDir,
    readPlan: async () => mkPlanContent(),
    updatePlanStatus: async () => {
      calls.push("updatePlanStatus");
    },
  } as any;

  await executePlanFlow(plan, [plan], planService, ctx, pi, "PROMPT");

  assert.equal(selects.length, 1);
  assert.equal(
    selects[0]?.[0],
    "Execution log detected for this plan. Resume from next pending task? (yes/no)",
  );
  assert.deepEqual(selects[0]?.[1], ["yes", "no"]);

  assert.equal(calls.includes("updatePlanStatus"), false);
  assert.equal(calls.includes("sendUserMessage"), false);

  assert.equal(
    notifications.some(([m]) => m === `Execution aborted. Delete ${plan.slug}.execution.jsonl to start from scratch.`),
    true,
  );
});

test("executePlanFlow resumes from next task index when log is confirmed", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "planning-resume-"));
  const plan = mkPlan(tmpDir);
  const logPath = path.join(tmpDir, `${plan.slug}.execution.jsonl`);

  await fs.writeFile(
    logPath,
    `${JSON.stringify({ timestamp: "2026-05-17T01:00:00.000Z", taskId: "task-1", decision: "skipped" })}\n`,
    "utf-8",
  );

  let sent = "";

  const ctx = {
    ui: {
      notify: () => {},
      select: async () => "yes",
      setWidget: () => {},
    },
    sessionManager: { getSessionFile: () => "s-1" },
  } as any;

  const pi = {
    setSessionName: () => {},
    getActiveTools: () => ["read", "bash", "edit", "write"],
    setActiveTools: () => {},
    appendEntry: () => {},
    sendUserMessage: (message: string) => {
      sent = message;
    },
  } as any;

  const planService = {
    getPlansPath: () => tmpDir,
    readPlan: async () => mkPlanContent(),
    updatePlanStatus: async () => {},
  } as any;

  await executePlanFlow(plan, [plan], planService, ctx, pi, "PROMPT");

  assert.match(sent, /<runtime_resume_instruction>Resume execution at Task 2 \(id: task-2\)\. Do not process any previous task\.<\/runtime_resume_instruction>/);
});

test("executePlanFlow routes to closure message when last task already logged", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "planning-resume-"));
  const plan = mkPlan(tmpDir);
  const logPath = path.join(tmpDir, `${plan.slug}.execution.jsonl`);

  await fs.writeFile(
    logPath,
    `${JSON.stringify({ timestamp: "2026-05-17T01:00:00.000Z", taskId: "task-2", decision: "skipped" })}\n`,
    "utf-8",
  );

  const notifications: string[] = [];
  const calls: string[] = [];

  const ctx = {
    ui: {
      notify: (message: string) => notifications.push(message),
      select: async () => "yes",
      setWidget: () => {
        calls.push("setWidget");
      },
    },
    sessionManager: { getSessionFile: () => "s-1" },
  } as any;

  const pi = {
    setSessionName: () => {},
    getActiveTools: () => ["read", "bash", "edit", "write"],
    setActiveTools: () => {},
    appendEntry: () => {
      calls.push("appendEntry");
    },
    sendUserMessage: () => {
      calls.push("sendUserMessage");
    },
  } as any;

  const planService = {
    getPlansPath: () => tmpDir,
    readPlan: async () => mkPlanContent(),
    updatePlanStatus: async () => {
      calls.push("updatePlanStatus");
    },
  } as any;

  await executePlanFlow(plan, [plan], planService, ctx, pi, "PROMPT");

  assert.equal(
    notifications.includes("Execution already reached the last task. Run unify/closure flow to finalize."),
    true,
  );
  assert.equal(calls.includes("updatePlanStatus"), false);
  assert.equal(calls.includes("sendUserMessage"), false);
});

test("executePlanFlow blocks on incoherent execution logs", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "planning-resume-"));
  const plan = mkPlan(tmpDir);
  const logPath = path.join(tmpDir, `${plan.slug}.execution.jsonl`);

  await fs.writeFile(logPath, "{invalid-json}\n", "utf-8");

  const notifications: Array<[string, string]> = [];
  const calls: string[] = [];

  const ctx = {
    ui: {
      notify: (msg: string, level: string) => notifications.push([msg, level]),
      select: async () => "yes",
      setWidget: () => {
        calls.push("setWidget");
      },
    },
    sessionManager: { getSessionFile: () => "s-1" },
  } as any;

  const pi = {
    setSessionName: () => {},
    getActiveTools: () => ["read", "bash", "edit", "write"],
    setActiveTools: () => {},
    appendEntry: () => {
      calls.push("appendEntry");
    },
    sendUserMessage: () => {
      calls.push("sendUserMessage");
    },
  } as any;

  const planService = {
    getPlansPath: () => tmpDir,
    readPlan: async () => mkPlanContent(),
    updatePlanStatus: async () => {
      calls.push("updatePlanStatus");
    },
  } as any;

  await executePlanFlow(plan, [plan], planService, ctx, pi, "PROMPT");

  assert.equal(calls.includes("updatePlanStatus"), false);
  assert.equal(calls.includes("sendUserMessage"), false);
  assert.equal(
    notifications.some(([m, level]) => level === "error" && /Manual execution log correction or deletion is required/.test(m)),
    true,
  );
});
