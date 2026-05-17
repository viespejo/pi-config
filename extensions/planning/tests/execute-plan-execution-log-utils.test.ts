import assert from "node:assert/strict";
import test from "node:test";

import { resolveStableTaskIds } from "../lib/dependencies.ts";
import {
  buildExecutionLogFilename,
  buildExecutionLogPath,
  parseExecutionLogJsonl,
} from "../lib/execution-log.ts";
import { PlanError } from "../lib/errors.ts";

test("buildExecutionLogFilename/buildExecutionLogPath derive per-plan JSONL location", () => {
  assert.equal(buildExecutionLogFilename("04-03-apply-execution-log-adaptation"), "04-03-apply-execution-log-adaptation.execution.jsonl");
  assert.equal(
    buildExecutionLogPath("/tmp/plans", "04-03-apply-execution-log-adaptation"),
    "/tmp/plans/04-03-apply-execution-log-adaptation.execution.jsonl",
  );
});

test("resolveStableTaskIds uses explicit textual ids and fallback task-<index>", () => {
  const ids = resolveStableTaskIds([
    { id: "task-alpha" },
    { id: "" },
    {},
    { taskId: "task-delta" },
  ]);

  assert.deepEqual(ids, ["task-alpha", "task-2", "task-3", "task-delta"]);
});

test("parseExecutionLogJsonl parses valid terminal records", () => {
  const content = [
    JSON.stringify({
      timestamp: "2026-05-17T01:00:00.000Z",
      taskId: "task-1",
      decision: "skipped",
    }),
    JSON.stringify({
      timestamp: "2026-05-17T01:01:00.000Z",
      taskId: "task-2",
      decision: "agent_applied",
      reviewStatus: "accepted",
      note: "Done",
    }),
  ].join("\n");

  const parsed = parseExecutionLogJsonl(content, ["task-1", "task-2", "task-3"]);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.taskIndex, 0);
  assert.equal(parsed[1]?.taskIndex, 1);
  assert.equal(parsed[1]?.record.reviewStatus, "accepted");
});

test("parseExecutionLogJsonl rejects invalid JSON line", () => {
  assert.throws(
    () => parseExecutionLogJsonl("{not-json}", ["task-1"]),
    (error: unknown) => error instanceof PlanError
      && error.code === "INVALID_EXECUTION_LOG"
      && /not valid JSON/.test(error.message),
  );
});

test("parseExecutionLogJsonl rejects invalid decision enum", () => {
  const content = JSON.stringify({
    timestamp: "2026-05-17T01:00:00.000Z",
    taskId: "task-1",
    decision: "apply_now",
  });

  assert.throws(
    () => parseExecutionLogJsonl(content, ["task-1"]),
    (error: unknown) => error instanceof PlanError
      && error.code === "INVALID_EXECUTION_LOG"
      && /invalid decision/.test(error.message),
  );
});

test("parseExecutionLogJsonl rejects unresolved task ids", () => {
  const content = JSON.stringify({
    timestamp: "2026-05-17T01:00:00.000Z",
    taskId: "missing-task",
    decision: "skipped",
  });

  assert.throws(
    () => parseExecutionLogJsonl(content, ["task-1"]),
    (error: unknown) => error instanceof PlanError
      && error.code === "INVALID_EXECUTION_LOG"
      && /unknown taskId/.test(error.message),
  );
});

test("parseExecutionLogJsonl requires reviewStatus for agent_applied", () => {
  const content = JSON.stringify({
    timestamp: "2026-05-17T01:00:00.000Z",
    taskId: "task-1",
    decision: "agent_applied",
  });

  assert.throws(
    () => parseExecutionLogJsonl(content, ["task-1"]),
    (error: unknown) => error instanceof PlanError
      && error.code === "INVALID_EXECUTION_LOG"
      && /requires valid reviewStatus/.test(error.message),
  );
});

test("parseExecutionLogJsonl rejects non-monotonic task order", () => {
  const content = [
    JSON.stringify({
      timestamp: "2026-05-17T01:00:00.000Z",
      taskId: "task-2",
      decision: "skipped",
    }),
    JSON.stringify({
      timestamp: "2026-05-17T01:01:00.000Z",
      taskId: "task-1",
      decision: "skipped",
    }),
  ].join("\n");

  assert.throws(
    () => parseExecutionLogJsonl(content, ["task-1", "task-2"]),
    (error: unknown) => error instanceof PlanError
      && error.code === "INVALID_EXECUTION_LOG"
      && /moves backwards/.test(error.message),
  );
});
