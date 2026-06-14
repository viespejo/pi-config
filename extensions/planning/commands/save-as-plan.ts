/**
 * Save Plan Command (Strict Planning Interview)
 *
 * Usage:
 *   /plan:save
 *   /plan:save focus on the error handling approach we discussed
 */

import {
  copyToClipboard,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { getConfig, loadConfig } from "../lib/config";
import { createPlanRepository } from "../lib/plan-repository";
import { createPlanService } from "../lib/plan-service";
import {
  resolveInterviewContext,
  resolvePlanReferencePaths,
} from "../lib/plan-save-context-resolver";

function buildStrictPlanningPrompt(params: {
  additionalInstructions: string;
  contextSummary: string;
  interviewContextReference: string;
  continuityContext: string;
  planFormatReferencePath: string;
  planTemplateReferencePath: string;
  numberingSuggestion: string;
  materializationDate: string;
}): string {
  const {
    additionalInstructions,
    contextSummary,
    interviewContextReference,
    continuityContext,
    planFormatReferencePath,
    planTemplateReferencePath,
    numberingSuggestion,
    materializationDate,
  } = params;

  const extra = additionalInstructions
    ? `\n<additional_instructions>\n${additionalInstructions}\n</additional_instructions>`
    : "";

  const contextBlock = `\n<loaded_context>\n<summary>\n${contextSummary}\n</summary>\n${interviewContextReference}\n</loaded_context>`;

  return `<purpose>
Execute strict planning workflow for /plan:save.
Collaborative-first: discuss and agree before any file write.
</purpose>

<references>
<reference_plan_format_path>${planFormatReferencePath}</reference_plan_format_path>
<reference_plan_template_path>${planTemplateReferencePath}</reference_plan_template_path>
<reference_usage>
Do not inline these references.
Do NOT read plan-format or plan-template during Delta Interview.
You may consult them only when finalizing the draft structure or after approval for materialization.
If template and format guidance conflict, follow the plan format reference.
</reference_usage>
</references>

<process>
<step name="delta_interview" priority="required">
Run collaborative planning interview before writing files.
Goal: agree implementation approach with explicit decision records.

<interview_behavior>
Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.
</interview_behavior>

<workflow_rules>
Follow a strict "Write-After-Approval" Confirmation Loop:

Shared steps (always):
1. In the chat, propose a summary of what you are going to register (Decision, Nuances, TODOs).
2. Ask for explicit confirmation from the user (e.g., "Is this correct?").

If persistence mode is NOT active:
3. DO NOT write interview artifacts to disk. The chat acts as a staging area.
4. ONLY AFTER the user approves or corrects the summary, update the in-chat tracked decisions/state (no disk artifacts yet).
5. Once the summary is confirmed, ask your next technical question.

If persistence mode IS active:
3. DO NOT write to disk yet. The chat acts as a staging area.
4. ONLY AFTER the user approves or corrects the summary, use your tools to update the physical artifacts.
5. Once written to disk, ask your next technical question.
</workflow_rules>

<negative_constraints>
To ensure the integrity of the design process, you MUST NOT do any of the following:
- DO NOT invent, infer, or assume decisions that the user has not explicitly approved.
- If we are in persistence mode, DO NOT write or edit the physical files on disk before receiving explicit confirmation from the user in the chat.
- If we are not in persistence mode, DO NOT write or edit physical interview artifacts on disk.
- DO NOT ask multiple technical questions at once. Walk down branches one by one.
- DO NOT compress or summarize discussions in the Consolidated Plan in a way that loses critical trade-offs or nuances.
</negative_constraints>

<persistence_activation>
Start in non-persistent mode.

Activate persistence mode when ANY of the following is true:
- The user explicitly asks to persist interview state or to resume later.
- The interview reaches long-session risk (>= 10 technical turns).
- There are >= 3 accepted non-trivial decisions.
- Cross-decision dependency coupling or contradiction risk is detected.

Activation behavior (mandatory):
- Persistence mode becomes mandatory for the rest of this /plan:save run.
- Before asking the next technical question, backfill all previously accepted decisions into:
  - Decision Log (\`..._log.md\`)
  - Consolidated Plan (\`..._plan.md\`)
- Ask user confirmation for each backfilled registration using the same confirmation loop rules.
</persistence_activation>

<tool_usage required_only_if="persistence_mode_active">
To prevent context degradation ("Lost in the Middle") over a long session, you MUST maintain two artifacts continuously on the local file system using your file manipulation tools:
1. A Decision Log (\`..._log.md\`)
2. A Consolidated Plan (\`..._plan.md\`)

Location: \`docs/technical-interviews/\` (create it if it doesn't exist).
Naming: If this is the first interaction, generate a unique filename with a temporary slug (e.g., \`tmp_abc123_log.md\`). Once the core topic is clear, use \`bash\` (e.g., \`mv\`) to rename the files to a descriptive topic-based slug.

Efficiency: DO NOT read the full artifacts every turn just to append to them (neither using the \`read\` tool nor \`cat\` in bash). Rely on your context window and target edits based on your memory.
Read-on-Demand: You ARE PERMITTED and encouraged to \`read\` the Consolidated Plan if you detect ambiguity, contradiction, or if you need to review critical past dependencies to formulate the next question.
</tool_usage>

<artifact_schemas required_only_if="persistence_mode_active">
Maintain stable Tracking IDs to ensure context stability. All artifacts must be written in English.

Decision Log (Append-only format):
Use stable IDs (DEC-001, DEC-002... and optionally TODO-001, RISK-001). Never rewrite or delete previous decisions.
Format:
## [ID]
- **Question**: ...
- **Context/Nuances**: ...
- **User Response**: ...
- **Decision**: ...
- **Status**: [Accepted / Pending]

Consolidated Plan (Mutable format):
This represents the current state of the design. Rewrite or append to sections as needed based on the Decision Log. It should read naturally, but MUST append \`[DEC-XXX]\` tracking tags at the end of relevant paragraphs to ensure traceability back to the log.
</artifact_schemas>

<examples>
GOOD Plan Snippet (natural narrative with traceability):
"The system will use a Postgres database to ensure ACID compliance [DEC-004]. However, to handle high read traffic, a Redis caching layer will be introduced later [DEC-005, TODO-002]."

BAD Plan Snippet (too robotic, missing narrative):
"- Database: Postgres [DEC-004]
- Cache: Redis [DEC-005]
- Pending: [TODO-002]"
</examples>

Rules:
- Use loaded interview context as primary source of truth when present.
- If interview context paths are provided, read those files before deciding whether Delta Interview is needed.
- Do not read plan-format or plan-template in this step.
- Start Delta Interview only if unresolved or uncertain implementation questions remain after reading available interview context.
- If no Delta questions remain, proceed directly to draft construction.
- Ask only missing/uncertain implementation questions (Delta-only).
- Do not jump to file generation while decisions are unresolved.
- If uncertainty remains, consult PRD/architecture on-demand.
</step>

<step name="build_draft" priority="required">
Produce plan draft in chat only (no writes yet).

<draft_contract>
The draft MUST follow this structure:
1) YAML frontmatter including at least:
   - title
   - phase
   - plan
   - date (MUST be exactly ${materializationDate})
   - status: pending
   - type
   - dependencies (array)
2) <objective>
3) <context>
4) <acceptance_criteria> (Given/When/Then)
5) <tasks> with task nodes including:
   - name
   - files
   - action
   - verify
   - done
6) <boundaries>
7) <verification>
</draft_contract>

Also suggest candidate phase/plan numbering and dependencies based on existing plans.
Use the following precomputed suggestion as a strong default unless user asks otherwise:

<numbering_suggestion>
${numberingSuggestion}
</numbering_suggestion>
</step>

<step name="approval_gate" priority="required">
Ask exactly: "Approve this plan draft for materialization? (yes/no)"
- If answer is "yes": proceed to materialization.
- Otherwise: continue refinement and DO NOT persist files.
</step>

<step name="create_plan_after_approval" priority="required">
After approval only:
0. Read both references (plan-format + plan-template) and run compliance against both files.
   - If they conflict, plan-format rules take precedence.
   - If any required rule from the winning reference set is unmet, stop and return to draft refinement (do not materialize).
1. Create/overwrite one plan file in '.agents/plans/'.
2. Use filename convention: '{PhaseNN}-{PlanNN}-{slug}.md' (example: '01-03-strict-planning-engine.md').
3. Generate full plan with required structure:
   - frontmatter: title, phase, plan, date, status, type, dependencies
   - sections: objective, context, acceptance_criteria, tasks, boundaries, verification
4. Ensure each task includes: name + files + action + verify + done.
5. Ensure each task's "done" explicitly maps to one or more acceptance criteria.
6. After writing, report a concise reference compliance result:
   - format_reference_read: yes/no
   - template_reference_read: yes/no
   - precedence_applied: plan-format | none
   - unmet_rules: none | bullet list
</step>

<step name="confirm_and_route" priority="required">
After materialization, display concise summary:
- plan path
- key tasks
- key risks
</step>
</process>

<output>
Plan file at '.agents/plans/{PhaseNN}-{PlanNN}-{slug}.md'
</output>

<constraints>
- Never write files before explicit "yes" approval.
- Keep backward compatibility for reading legacy plans.
</constraints>
${contextBlock}
${continuityContext}${extra}

<materialization_target>
After approval only, materialize in .agents/plans/.
</materialization_target>`;
}

export function setupSaveAsPlanCommand(pi: ExtensionAPI) {
  pi.registerCommand("plan:save", {
    description: "Create implementation plan from conversation",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      await loadConfig();

      const additionalInstructions = args.trim();
      const { activeTechnicalInterviewSlug, plansDir, interviewContextSortOrder } = getConfig();

      const repository = createPlanRepository(ctx.cwd, { plansDir });
      const planService = createPlanService(repository);
      const planSuggestion = await planService.suggestNextPlan();

      const numberingSuggestion = [
        `Recommended (continue current phase): ${planSuggestion.recommendedFilenamePrefix}`,
        `Recommended phase metadata: ${planSuggestion.recommendedPhase}`,
        `Recommended plan metadata: ${planSuggestion.recommendedPlan}`,
        `Recommended dependencies: ${planSuggestion.recommendedDependencies.length ? planSuggestion.recommendedDependencies.join(", ") : "none"}`,
        `Alternative (start new phase): ${planSuggestion.alternativeNewPhaseFilenamePrefix}`,
        `Reference latest plan: ${planSuggestion.latestPlan ?? "none"}`,
      ].join("\n");

      const resolved = await resolveInterviewContext({
        cwd: ctx.cwd,
        plansDir,
        additionalInstructions,
        activeSlug: activeTechnicalInterviewSlug,
        requestedDependencies: [],
        interviewContextSortOrder,
        ctx,
      });

      if (resolved.source === "cancelled") {
        ctx.ui.notify("/plan:save cancelled", "info");
        return;
      }

      if (resolved.source === "none") {
        ctx.ui.notify(
          "No prior technical interview context found; starting fresh Delta interview",
          "info",
        );
      } else if (resolved.candidate) {
        ctx.ui.notify(
          `Loaded technical interview context: ${resolved.candidate.slug} (source: ${resolved.source})`,
          "info",
        );
      }

      const contextSummary = resolved.candidate
        ? `Context slug: ${resolved.candidate.slug}\nSource: ${resolved.source}${resolved.confidence ? `\nConfidence: ${resolved.confidence}` : ""}`
        : "Context source: none";

      const interviewContextReference = resolved.candidate
        ? `<interview_context mode="deterministic">\n<slug>${resolved.candidate.slug}</slug>\n<source>${resolved.source}</source>\n<log_path>${resolved.candidate.logPath}</log_path>\n<plan_path>${resolved.candidate.planPath}</plan_path>\n<read_requirement>Read both files before deciding whether Delta Interview is needed and before producing final draft.</read_requirement>\n</interview_context>`
        : "<interview_context mode=\"none\">No technical interview context selected.</interview_context>";

      const continuityContext = resolved.summaries.length
        ? `<continuity_context>\n<summary_sources>\n${resolved.summaries
            .map((s) => `- ${s.path}`)
            .join("\n")}\n</summary_sources>\n<usage_rules>\n- Summaries are available as references only; they are not preloaded.\n- Summaries describe what actually shipped in previous plan executions.\n- Prefer summaries over original plan files when reasoning about completed prior work.\n- Read relevant summaries on-demand before choosing dependencies or designing follow-up work.\n- If interview context and summaries conflict, ask the user during Delta Interview.\n</usage_rules>\n</continuity_context>`
        : `<continuity_context>\n<summary_sources>none</summary_sources>\n</continuity_context>`;

      const referencePaths = await resolvePlanReferencePaths();
      if (!referencePaths) {
        ctx.ui.notify(
          "Could not resolve planning references: expected plan-format.md and plan-template.md",
          "error",
        );
        return;
      }

      const { planFormatReferencePath, planTemplateReferencePath } = referencePaths;

      const materializationDate = new Date().toISOString().slice(0, 10);

      let prompt = buildStrictPlanningPrompt({
        additionalInstructions,
        contextSummary,
        interviewContextReference,
        continuityContext,
        planFormatReferencePath,
        planTemplateReferencePath,
        numberingSuggestion,
        materializationDate,
      });

      if (ctx.hasUI) {
        const choice = await ctx.ui.select("/plan:save · prompt delivery", [
          "Send now",
          "Preview/edit before sending",
          "Copy prompt to clipboard",
          "Cancel",
        ]);

        if (!choice || choice === "Cancel") {
          ctx.ui.notify("/plan:save cancelled", "info");
          return;
        }

        if (choice === "Preview/edit before sending") {
          const edited = await ctx.ui.editor(
            "Review/edit the prompt to be sent:",
            prompt,
          );

          if (typeof edited !== "string") {
            ctx.ui.notify("/plan:save cancelled", "info");
            return;
          }

          if (!edited.trim()) {
            ctx.ui.notify("Empty prompt: /plan:save cancelled", "warning");
            return;
          }

          prompt = edited;
        }

        if (choice === "Copy prompt to clipboard") {
          try {
            copyToClipboard(prompt);
            ctx.ui.notify("Prompt copied to clipboard", "info");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`Failed to copy prompt: ${message}`, "error");
          }
          return;
        }
      }

      pi.sendUserMessage(prompt);
    },
  });
}
