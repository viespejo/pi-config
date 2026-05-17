import assert from "node:assert/strict";
import test from "node:test";

import { buildStrictApplyExecutePrompt } from "../lib/prompts/execute-plan-prompt.ts";

test("execute prompt includes tool-based execution logging contract", () => {
  const prompt = buildStrictApplyExecutePrompt();

  assert.match(prompt, /<execution_logging>/);
  assert.match(prompt, /plan_log_task_terminal/);
  assert.match(prompt, /Do NOT use edit\/write tools/);
  assert.match(prompt, /required: taskId, decision/);
  assert.match(prompt, /optional: reviewStatus, note/);
  assert.match(prompt, /agent_applied/);
  assert.match(prompt, /skipped/);
  assert.match(prompt, /accepted/);
  assert.match(prompt, /amended_manually/);
  assert.match(prompt, /runtime injects timestamp and sessionId/);
});

test("execute prompt includes explicit resume rules outside execution logging", () => {
  const prompt = buildStrictApplyExecutePrompt();

  assert.match(prompt, /<step name="resume_rules" priority="required">/);
  assert.match(prompt, /If runtime provides `<runtime_resume_instruction>`, follow it exactly/);
  assert.match(prompt, /Never process tasks earlier than the instructed resume task/);
});

test("execute prompt includes richer task interaction guidance", () => {
  const prompt = buildStrictApplyExecutePrompt();

  assert.match(prompt, /engineering-focused minimal summary/);
  assert.match(prompt, /Key technical considerations/);
  assert.match(prompt, /Suggested verification/);
  assert.match(prompt, /context-rich planned edit previews/);
  assert.match(prompt, /5-10 lines of surrounding context/);
  assert.match(prompt, /Conversation pauses/);
  assert.match(prompt, /Do not treat conversational drift as a task decision/);
  assert.match(prompt, /sensitive operations/);
  assert.match(prompt, /user-raised concerns/);
});
