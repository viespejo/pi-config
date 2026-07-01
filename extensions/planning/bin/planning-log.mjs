#!/usr/bin/env node
import * as fs from "node:fs/promises";
import { parseArgs } from "node:util";

const VALID_DECISIONS = new Set(["agent_applied", "skipped"]);
const VALID_REVIEW_STATUSES = new Set(["accepted", "amended_manually"]);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function requireNonEmpty(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function parseOptions(argv) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      log: { type: "string" },
      "task-id": { type: "string" },
      decision: { type: "string" },
      "review-status": { type: "string" },
      note: { type: "string" },
      "session-id": { type: "string" },
    },
  });
}

function buildTerminalRecord(values) {
  const logPath = requireNonEmpty(values.log, "--log");
  const taskId = requireNonEmpty(values["task-id"], "--task-id");
  const decision = requireNonEmpty(values.decision, "--decision");
  const reviewStatus = values["review-status"];

  if (!VALID_DECISIONS.has(decision)) {
    throw new Error("--decision must be agent_applied or skipped");
  }

  if (decision === "agent_applied" && !reviewStatus) {
    throw new Error("--review-status is required when --decision is agent_applied");
  }

  if (decision === "skipped" && reviewStatus) {
    throw new Error("--review-status must not be provided when --decision is skipped");
  }

  if (reviewStatus && !VALID_REVIEW_STATUSES.has(reviewStatus)) {
    throw new Error("--review-status must be accepted or amended_manually");
  }

  return {
    logPath,
    record: {
      timestamp: new Date().toISOString(),
      taskId,
      decision,
      ...(values["session-id"] ? { sessionId: values["session-id"] } : {}),
      ...(reviewStatus ? { reviewStatus } : {}),
      ...(values.note ? { note: values.note } : {}),
    },
  };
}

function buildFollowUpRecord(values) {
  const logPath = requireNonEmpty(values.log, "--log");
  const taskId = requireNonEmpty(values["task-id"], "--task-id");
  const note = requireNonEmpty(values.note, "--note");

  if (values.decision || values["review-status"]) {
    throw new Error("--decision and --review-status must not be provided for task-follow-up");
  }

  return {
    logPath,
    record: {
      timestamp: new Date().toISOString(),
      taskId,
      recordType: "follow_up",
      ...(values["session-id"] ? { sessionId: values["session-id"] } : {}),
      note,
    },
  };
}

async function main() {
  const { positionals, values } = parseOptions(process.argv.slice(2));
  const command = positionals[0];

  let built;
  if (command === "task-terminal") {
    built = buildTerminalRecord(values);
  } else if (command === "task-follow-up") {
    built = buildFollowUpRecord(values);
  } else {
    throw new Error("command must be task-terminal or task-follow-up");
  }

  await fs.appendFile(built.logPath, `${JSON.stringify(built.record)}\n`, "utf-8");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
