import { buildStrictApplyExecutePrompt } from "./execute-plan-prompt.ts";

const PI_EXECUTION_LOGGING_BLOCK = `<execution_logging>
For each terminal task outcome, call tool \`plan_log_task_terminal\`.
If later work on the same task adds relevant execution details, amendments, deviations, verification notes, or user review context, call \`plan_log_task_terminal\` again for that same task with the new information in \`note\`.
Do NOT use edit/write tools to append execution log records.

Tool payload for terminal task outcomes:
- required: taskId, decision
- optional: recordType="terminal", reviewStatus, note

Tool payload for follow-up information:
- required: taskId, recordType="follow_up", note
- do not include decision or reviewStatus

Decision enum for terminal records:
- agent_applied
- skipped

reviewStatus enum (only when decision=agent_applied):
- accepted
- amended_manually

Timing rules:
- skipped: call tool immediately after skip decision.
- agent_applied: call tool only after post-apply review ([A] Accept or [B] amended manually).

Notes:
- taskId must use stable textual task id when available, otherwise fallback to task-<1-based-index>.
- If the user's menu/review response includes text after the selected option, capture that text as the optional note/rationale.
- Use note to preserve relevant deviations, approved overrides, sensitive-operation confirmations, user-raised concerns, follow-up amendments, and verification observations for the task.
- Use recordType="follow_up" when later work, including work discovered during another task, adds material context for an already logged task.
- Avoid duplicate log calls for the same information; additional calls for the same task should add materially new context.
- Do not log conversational pauses, questions, or discussion as terminal task outcomes unless the user ultimately selects Skip or completes post-apply review.
- runtime injects timestamp and sessionId.
</execution_logging>`;

export function buildClaudeCodeStrictApplyExecutePrompt(params: {
  summaryTemplateReferencePath: string;
  executionLogPath: string;
  executionLogCliCommand: string;
  allowedTaskIds: string[];
}): string {
  const {
    summaryTemplateReferencePath,
    executionLogPath,
    executionLogCliCommand,
    allowedTaskIds,
  } = params;

  const cliExecutionLoggingBlock = `<execution_logging>
Claude Code is running outside PI. PI custom tools and PI session runtime are not available.
Do not use \`plan_log_task_terminal\` as an available tool.
Use bash to append execution-log records through the standalone CLI.
Do NOT manually edit the execution log file.
Do NOT use edit/write tools to append execution log records.

Execution log path:
${executionLogPath}

Allowed task ids:
${allowedTaskIds.map((taskId) => `- ${taskId}`).join("\n")}

Exact execution-log CLI invocation:
${executionLogCliCommand}

CLI payload for terminal task outcomes:
- command: task-terminal
- required flags: --log <path>, --task-id <id>, --decision <agent_applied|skipped>
- optional flags: --review-status <accepted|amended_manually>, --note <text>, --session-id <text>
- agent_applied requires --review-status.
- skipped must not include --review-status.

CLI payload for follow-up information:
- command: task-follow-up
- required flags: --log <path>, --task-id <id>, --note <text>
- optional flags: --session-id <text>
- always writes recordType: "follow_up".
- do not include decision or review status payload semantics.

Decision enum for terminal records:
- agent_applied
- skipped

reviewStatus enum (only when decision=agent_applied):
- accepted
- amended_manually

Timing rules:
- skipped: run the CLI immediately after skip decision.
- agent_applied: run the CLI only after post-apply review ([A] Accept or [B] amended manually).

CLI command examples:
- Applied and accepted:
  \`${executionLogCliCommand} task-terminal --log ${executionLogPath} --task-id ${allowedTaskIds[0] ?? "task-1"} --decision agent_applied --review-status accepted --note "Implemented and verified."\`
- Skipped:
  \`${executionLogCliCommand} task-terminal --log ${executionLogPath} --task-id ${allowedTaskIds[1] ?? allowedTaskIds[0] ?? "task-1"} --decision skipped --note "Skipped per user request."\`
- Follow-up:
  \`${executionLogCliCommand} task-follow-up --log ${executionLogPath} --task-id ${allowedTaskIds[0] ?? "task-1"} --note "Additional verification context."\`

Notes:
- taskId must use stable textual task id when available, otherwise fallback to task-<1-based-index>.
- Only log task ids listed in Allowed task ids.
- If the user's menu/review response includes text after the selected option, capture that text as the optional note/rationale.
- Use note to preserve relevant deviations, approved overrides, sensitive-operation confirmations, user-raised concerns, follow-up amendments, and verification observations for the task.
- Use task-follow-up when later work, including work discovered during another task, adds material context for an already logged task.
- Avoid duplicate CLI log calls for the same information; additional calls for the same task should add materially new context.
- Do not log conversational pauses, questions, or discussion as terminal task outcomes unless the user ultimately selects Skip or completes post-apply review.
- The CLI injects timestamp automatically.
- The CLI includes sessionId only when --session-id is provided.
</execution_logging>`;

  return buildStrictApplyExecutePrompt({ summaryTemplateReferencePath })
    .replace(PI_EXECUTION_LOGGING_BLOCK, cliExecutionLoggingBlock);
}
