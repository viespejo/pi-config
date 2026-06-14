# Plan Summary Template

Template for `.agents/plans/{PhaseNN}-{PlanNN}-{slug}-SUMMARY.md`.

## Purpose

A plan summary captures what actually shipped and the context future plans should rely on. It is not a full execution transcript. It should be concise, durable, and optimized for future `/plan:save` context assembly.

The summary should answer:

- What changed in the system?
- What can future plans safely build on?
- Which files, decisions, and patterns matter next?
- What deviations, skipped work, or caveats should not be forgotten?

## File Template

```markdown
# {Plan Title} — Summary

## Outcome

[One or two concise paragraphs describing what actually shipped. Focus on final behavior, not the original intent.]

## Provides

- [Capability, behavior, invariant, API, workflow, or guarantee future plans can rely on]
- [Another provided capability]

## Key Files

- `{path}` — [Why this file matters for future work]
- `{path}` — [What changed or what contract it owns]

## Key Decisions

| Decision | Rationale | Future impact |
| -------- | --------- | ------------- |
| [What was decided] | [Why this choice was made] | [How future plans should account for it] |

If no material decisions were made beyond the plan, write:

None beyond the approved plan.

## Patterns Established

- [Implementation or workflow pattern future plans should preserve]
- [Testing, validation, UI, state, telemetry, or integration convention]

If no reusable pattern was established, write:

None.

## Execution Notes

| Task | Outcome | Review | Notes |
| ---- | ------- | ------ | ----- |
| [Task id/name] | agent_applied / skipped | accepted / amended_manually / n/a | [Important note, amendment, or skip rationale] |

## Deviations / Caveats

- [Deviation from the plan, manual amendment, skipped work, or caveat]
- [Known limitation or uncertainty]

If execution matched the plan without relevant caveats, write:

None.

## Verification

- [Command or manual verification performed, with result]
- [Known verification not performed, if relevant]

## Future Planning Context

### Ready to build on

- [Concrete capability or file area ready for follow-up plans]

### Concerns

- [Risk, fragility, unresolved uncertainty, or maintenance concern]

### Follow-up candidates

- [Potential future plan or improvement]

### Blockers

- [Anything blocking future work, or `None`]
```

## Guidance

- Prefer what actually shipped over what was originally planned.
- Keep the summary useful for a future agent that has not seen the execution conversation.
- Include important user amendments and skipped tasks, but do not copy the full execution log.
- Use `Key Decisions` for choices that future plans must not accidentally reverse.
- Use `Patterns Established` for conventions future plans should follow.
- Use `Future Planning Context` to make the next `/plan:save` easier and safer.
- Be honest about uncertainty. If verification was not performed, say so explicitly.
