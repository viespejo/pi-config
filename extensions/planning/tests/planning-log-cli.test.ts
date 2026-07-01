import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import { parseExecutionLogJsonl } from "../lib/execution-log.ts";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("bin/planning-log.mjs");

async function makeTempLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "planning-log-cli-"));
  return path.join(dir, "plan.execution.jsonl");
}

async function runCli(args: string[]) {
  return execFileAsync(process.execPath, [cliPath, ...args]);
}

async function readRecords(logPath: string) {
  const content = await fs.readFile(logPath, "utf-8");
  return content
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
}

test("planning-log task-terminal writes agent_applied terminal records", async () => {
  const logPath = await makeTempLog();

  await runCli([
    "task-terminal",
    "--log", logPath,
    "--task-id", "task-1",
    "--decision", "agent_applied",
    "--review-status", "accepted",
    "--note", "Applied successfully.",
    "--session-id", "session-123",
  ]);

  const records = await readRecords(logPath);
  assert.equal(records.length, 1);
  assert.match(records[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(records[0].taskId, "task-1");
  assert.equal(records[0].decision, "agent_applied");
  assert.equal(records[0].reviewStatus, "accepted");
  assert.equal(records[0].note, "Applied successfully.");
  assert.equal(records[0].sessionId, "session-123");
  assert.equal(records[0].recordType, undefined);
});

test("planning-log task-terminal writes skipped terminal records", async () => {
  const logPath = await makeTempLog();

  await runCli([
    "task-terminal",
    "--log", logPath,
    "--task-id", "task-2",
    "--decision", "skipped",
    "--note", "Not needed.",
  ]);

  const records = await readRecords(logPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].taskId, "task-2");
  assert.equal(records[0].decision, "skipped");
  assert.equal(records[0].reviewStatus, undefined);
  assert.equal(records[0].note, "Not needed.");
});

test("planning-log task-follow-up writes follow-up records", async () => {
  const logPath = await makeTempLog();

  await runCli([
    "task-follow-up",
    "--log", logPath,
    "--task-id", "task-1",
    "--note", "Later context.",
    "--session-id", "session-456",
  ]);

  const records = await readRecords(logPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].taskId, "task-1");
  assert.equal(records[0].recordType, "follow_up");
  assert.equal(records[0].decision, undefined);
  assert.equal(records[0].reviewStatus, undefined);
  assert.equal(records[0].note, "Later context.");
  assert.equal(records[0].sessionId, "session-456");
});

test("planning-log task-terminal rejects missing review status for agent_applied", async () => {
  const logPath = await makeTempLog();

  await assert.rejects(
    runCli([
      "task-terminal",
      "--log", logPath,
      "--task-id", "task-1",
      "--decision", "agent_applied",
    ]),
    /--review-status is required/,
  );

  await assert.rejects(fs.readFile(logPath, "utf-8"), /ENOENT/);
});

test("planning-log task-terminal rejects review status for skipped", async () => {
  const logPath = await makeTempLog();

  await assert.rejects(
    runCli([
      "task-terminal",
      "--log", logPath,
      "--task-id", "task-1",
      "--decision", "skipped",
      "--review-status", "accepted",
    ]),
    /--review-status must not be provided/,
  );

  await assert.rejects(fs.readFile(logPath, "utf-8"), /ENOENT/);
});

test("planning-log task-follow-up rejects missing note", async () => {
  const logPath = await makeTempLog();

  await assert.rejects(
    runCli([
      "task-follow-up",
      "--log", logPath,
      "--task-id", "task-1",
    ]),
    /--note is required/,
  );

  await assert.rejects(fs.readFile(logPath, "utf-8"), /ENOENT/);
});

test("planning-log output is compatible with execution log parser", async () => {
  const logPath = await makeTempLog();

  await runCli([
    "task-terminal",
    "--log", logPath,
    "--task-id", "task-1",
    "--decision", "agent_applied",
    "--review-status", "amended_manually",
    "--note", "User amended manually.",
  ]);
  await runCli([
    "task-terminal",
    "--log", logPath,
    "--task-id", "task-2",
    "--decision", "skipped",
  ]);
  await runCli([
    "task-follow-up",
    "--log", logPath,
    "--task-id", "task-1",
    "--note", "Follow-up detail.",
  ]);

  const content = await fs.readFile(logPath, "utf-8");
  const parsed = parseExecutionLogJsonl(content, ["task-1", "task-2"]);

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.record.decision, "agent_applied");
  assert.equal(parsed[0]?.record.reviewStatus, "amended_manually");
  assert.equal(parsed[1]?.record.decision, "skipped");
  assert.equal(parsed[2]?.record.recordType, "follow_up");
  assert.equal(parsed[2]?.record.note, "Follow-up detail.");
});
