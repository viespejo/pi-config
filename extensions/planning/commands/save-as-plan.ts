/**
 * Save Plan Command (Strict Planning Interview)
 *
 * Usage:
 *   /plan:save
 *   /plan:save focus on the error handling approach we discussed
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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

<collaborative_interview_contract>
For each major decision, use this exact structure:
[Planning Decision N]
Story: <story id/title>
Decision area: <api/data/ui/testing/deployment/etc>
Why it matters: <impact>

Recommendation:
<preferred option + rationale>

Pros:
- ...

Cons:
- ...

Devil's advocate:
- <strong objection or failure mode>

Risks:
- Risk: <description>
  Probability: <low/med/high>
  Impact: <low/med/high>
  Mitigation: <action>

Decision status:
- accepted | rejected | parked

Notes:
- assumptions
- dependencies
- follow-up checks
</collaborative_interview_contract>

Rules:
- Use loaded interview context as primary source of truth when present.
- If interview context paths are provided, read those files before deciding whether Delta Interview is needed.
- Do not read plan-format or plan-template in this step.
- Ask only missing/uncertain implementation questions (Delta-only).
- Resolve one major decision at a time.
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
            .map((s) => `- ${s.filename}`)
            .join("\n")}\n</summary_sources>\n<usage_rules>\n- Summaries are available as references only (not preloaded).\n- Consult summary files on-demand if continuity gaps appear.\n- If interview context and summaries conflict, ask the user during Delta Interview.\n</usage_rules>\n</continuity_context>`
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

      const prompt = buildStrictPlanningPrompt({
        additionalInstructions,
        contextSummary,
        interviewContextReference,
        continuityContext,
        planFormatReferencePath,
        planTemplateReferencePath,
        numberingSuggestion,
        materializationDate,
      });

      pi.sendUserMessage(prompt);
    },
  });
}
