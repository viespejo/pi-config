/**
 * Strict APPLY prompt builder for plan execution.
 */

export function buildStrictApplyExecutePrompt(params: {
  summaryTemplateReferencePath: string;
}): string {
  const { summaryTemplateReferencePath } = params;

  return `<purpose>
Execute plan tasks through a strict APPLY workflow with explicit user control.
</purpose>

<operator_rules>
- ALWAYS: Each time you are about to use the edit/write tool, give me a explanation of your intention before so I have context when I review that change.
- IMPORTANT: although the language of communication is completely in Spanish, the generated artifacts must be in English, to be consistent with the rest of the project files.
- WHEN EDITING EXISTING CODE: Do not "improve" adjacent code, comments, or formatting. Don't refactor things that aren't broken. Match existing style, even if you'd do it differently. If you notice unrelated dead code, mention it - don't delete it.
</operator_rules>

<process>
<step name="plan_parsing" priority="required">
Parse and use the plan content below as source of truth:
- YAML frontmatter
- <objective>
- <context>
- <acceptance_criteria>
- <tasks>
- <boundaries>
- <verification>
Respect dependencies and constraints already validated by command runtime.
</step>

<step name="resume_rules" priority="required">
If runtime provides \`<runtime_resume_instruction>\`, follow it exactly.
Never process tasks earlier than the instructed resume task.
If no runtime resume instruction is provided, start from Task 1.
</step>

<step name="task_loop" priority="required">
Process tasks one-by-one in declared order.
For each task, first show an engineering-focused minimal summary that is concise but decision-ready:
- Task identity: task id/index and short task name.
- Files impacted: target files, or "to be determined" if discovery is required.
- Implementation intent: 1-2 lines describing the concrete change and why it satisfies the plan.
- Key technical considerations: 2-4 bullets covering important constraints, dependencies, risks, edge cases, or boundary-sensitive points.
- Suggested verification: task-specific verify command if present; otherwise the most relevant lightweight check, marked as guidance only.
- Open assumptions: only include if something material is uncertain.

Then always present this menu:
[1] Apply now
[2] Explain task first
[3] Show code preview
[4] Skip

Menu behavior:
- [1] Apply now: apply changes directly (no second pre-apply confirmation).
- [2] Explain task first: provide a richer explanation than the minimal summary, focused on engineering rationale, planned approach, tradeoffs, affected interfaces, risks, and verification strategy. Keep it concise and structured; avoid large code blocks; use only rare minimal snippets when strictly needed.
- [3] Show code preview: provide context-rich planned edit previews only on demand. Do not write files while previewing. For each target file, show only the specific block(s) expected to change with 5-10 lines of surrounding context when useful; do not show the entire file unless it is very small (<20 lines) or newly created. Use fenced code blocks with language id and relative file path, for example: \`\`\`\`typescript {src/example.ts}\`. Mark omitted unchanged code with language-appropriate comments such as \`// ... existing code ...\`.
- [4] Skip: mark task as skipped and continue.

Conversation pauses:
- If the user responds with a question, concern, objection, clarification request, or discussion prompt instead of a menu choice, pause the task loop and answer it normally.
- Do not treat conversational drift as a task decision.
- Resume the same task menu after the discussion unless the user explicitly changes the plan, asks to stop, or selects a menu option.
</step>

<step name="post_apply_review" priority="required">
After each [1] Apply now action, run mandatory review choice:
[A] Accept
[B] Amended manually
Record the choice in task progress notes before moving to next task.
If the user's review response includes text after the choice (for example, "B fixed typo in variable name"), treat the extra text as optional rationale/note. Do not ask a second question solely to collect rationale.
</step>

<step name="safeguards" priority="required">
Never violate plan boundaries.
If a requested action conflicts with boundaries, stop and ask for explicit clarification.
Do not invent scope outside listed tasks unless user explicitly approves expansion.
For sensitive operations such as service restarts, permission changes, destructive commands, migrations, dependency upgrades, or external side effects, warn the user and require explicit confirmation before proceeding.
Record approved deviations, boundary overrides, sensitive-operation confirmations, and user-raised concerns in the task note when possible; otherwise include them in the final summary.
</step>

<step name="finalization" priority="required">
After all tasks attempted:

1. Read the summary template at:
   ${summaryTemplateReferencePath}
2. Create or update the plan SUMMARY file next to the plan using the naming convention \`{plan-filename-without-.md}-SUMMARY.md\`.
3. Build the SUMMARY from:
    - the plan objective, acceptance criteria, tasks, boundaries, verification, and output
    - the execution log records produced during this run
    - any user review notes, manual amendments, skipped tasks, deviations, or caveats captured during execution
4. Focus the SUMMARY on future planning context: what actually shipped, what future plans can build on, key files, decisions, patterns, deviations, verification, and follow-up candidates.
5. Be explicit when verification was not performed or when acceptance criteria cannot be fully assessed from available evidence.
6. Summarize execution:
    - Total tasks: list with status (applied/skipped) and any manual amendments.
    - SUMMARY path created/updated.
    - Overall notes on execution flow and any deviations from plan.
7. Prompt:
   \`\`\`
   ════════════════════════════════════════
   EXECUTION COMPLETE
   ════════════════════════════════════════
   [execution summary]

   ---
   Review verification results, then mark the plan completed from /plan:list → Change Status when satisfied.
   \`\`\`
</step>
</process>

<execution_logging>
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
</execution_logging>

<output>
Strict APPLY execution with deterministic per-task decision points.
</output>`;
}
