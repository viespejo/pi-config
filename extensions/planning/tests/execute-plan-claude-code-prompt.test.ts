import assert from "node:assert/strict";
import test from "node:test";

import { buildClaudeCodeStrictApplyExecutePrompt } from "../lib/prompts/execute-plan-claude-code-prompt.ts";

function buildPrompt(): string {
  return buildClaudeCodeStrictApplyExecutePrompt({
    summaryTemplateReferencePath: "/tmp/summary-template.md",
    executionLogPath: "/tmp/example.execution.jsonl",
    executionLogCliCommand: "node /extension/bin/planning-log.mjs",
    allowedTaskIds: ["task-1", "task-alpha"],
  });
}

test("Claude Code execute prompt includes CLI execution logging contract", () => {
  const prompt = buildPrompt();

  assert.match(prompt, /<execution_logging>/);
  assert.match(prompt, /Claude Code is running outside PI/);
  assert.match(prompt, /PI custom tools and PI session runtime are not available/);
  assert.match(prompt, /Use bash to append execution-log records/);
  assert.match(prompt, /Do NOT manually edit the execution log file/);
  assert.match(prompt, /Do NOT use edit\/write tools/);
  assert.match(prompt, /Execution log path:\n\/tmp\/example\.execution\.jsonl/);
  assert.match(prompt, /Exact execution-log CLI invocation:\nnode \/extension\/bin\/planning-log\.mjs/);
});

test("Claude Code execute prompt includes allowed task ids and CLI examples", () => {
  const prompt = buildPrompt();

  assert.match(prompt, /Allowed task ids:\n- task-1\n- task-alpha/);
  assert.match(prompt, /task-terminal --log \/tmp\/example\.execution\.jsonl --task-id task-1 --decision agent_applied --review-status accepted/);
  assert.match(prompt, /task-terminal --log \/tmp\/example\.execution\.jsonl --task-id task-alpha --decision skipped/);
  assert.match(prompt, /task-follow-up --log \/tmp\/example\.execution\.jsonl --task-id task-1 --note/);
});

test("Claude Code execute prompt preserves terminal and follow-up semantics", () => {
  const prompt = buildPrompt();

  assert.match(prompt, /required flags: --log <path>, --task-id <id>, --decision <agent_applied\|skipped>/);
  assert.match(prompt, /agent_applied requires --review-status/);
  assert.match(prompt, /skipped must not include --review-status/);
  assert.match(prompt, /required flags: --log <path>, --task-id <id>, --note <text>/);
  assert.match(prompt, /always writes recordType: "follow_up"/);
  assert.match(prompt, /do not include decision or review status payload semantics/);
  assert.match(prompt, /Decision enum for terminal records/);
  assert.match(prompt, /reviewStatus enum/);
  assert.match(prompt, /accepted/);
  assert.match(prompt, /amended_manually/);
});

test("Claude Code execute prompt preserves timing and note guidance", () => {
  const prompt = buildPrompt();

  assert.match(prompt, /skipped: run the CLI immediately after skip decision/);
  assert.match(prompt, /agent_applied: run the CLI only after post-apply review/);
  assert.match(prompt, /If the user's menu\/review response includes text after the selected option/);
  assert.match(prompt, /Use note to preserve relevant deviations/);
  assert.match(prompt, /Avoid duplicate CLI log calls/);
  assert.match(prompt, /Do not log conversational pauses/);
  assert.match(prompt, /The CLI injects timestamp automatically/);
  assert.match(prompt, /sessionId only when --session-id is provided/);
});

test("Claude Code execute prompt does not instruct tool-based logging", () => {
  const prompt = buildPrompt();

  assert.doesNotMatch(prompt, /For each terminal task outcome, call tool `plan_log_task_terminal`/);
  assert.doesNotMatch(prompt, /call `plan_log_task_terminal` again/);
  assert.doesNotMatch(prompt, /Tool payload for terminal task outcomes/);
  assert.doesNotMatch(prompt, /runtime injects timestamp and sessionId/);
});
