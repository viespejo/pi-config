<plan_format>

## Purpose

PLAN.md is an executable planning artifact. It contains everything needed to implement a scoped change: objective, context, acceptance criteria, tasks, boundaries, verification, and output specification.

**Core principle:** A plan is executable when an AI Agent can read the PLAN.md and immediately start implementing without asking clarifying questions.

If the AI Agent has to guss, interpret, or make assumptions - the task is too vague.

## Frontmatter

Every PLAN.md starts with YAML frontmatter:

```yaml
---
title: "Human readable title"
phase: "NN-phase-name"
plan: "NN"
date: "YYYY-MM-DD"
status: "pending"
type: "execute"
dependencies: []
---
```

| Field | Required | Purpose |
|-------|----------|---------|
| `title` | Yes | Human-readable plan title |
| `phase` | Yes | Phase identifier (e.g., `01-strict-planning`) |
| `plan` | Yes | Plan number within phase (e.g., `01`, `02`) |
| `date` | Yes | Plan creation date in ISO format (`YYYY-MM-DD`) |
| `status` | Yes | Initial status for new plans (`pending`) |
| `type` | Yes | `execute` for standard, `tdd` for test-driven, `research` for exploration |
| `dependencies` | Yes | Array of dependency plan slugs this plan requires |

## Plan Structure

```markdown
---
[frontmatter]
---

<objective>
## Goal
[What this plan accomplishes - specific, measurable]

## Purpose
[Why this matters for the project]

## Output
[What artifacts will be created/modified]
</objective>

<context>
docs/technical-interviews/<slug>_log.md
docs/technical-interviews/<slug>_plan.md
`relevant/source/files.ts`
</context>

<acceptance_criteria>
## AC-1: [Criterion Name]
Given [precondition]
When [action]
Then [expected outcome]
</acceptance_criteria>

<tasks>
[Task definitions]
</tasks>

<boundaries>
## DO NOT CHANGE
[Protected files/patterns]

## SCOPE LIMITS
[What's explicitly out of scope]
</boundaries>

<verification>
[Overall phase checks]
</verification>

<success_criteria>
[Measurable completion criteria]
</success_criteria>

<output>
[SUMMARY.md specification]
</output>
```

## Task Anatomy

Every `auto` task has four required fields:

### files
**What it is:** Exact file paths created or modified.

```xml
<!-- GOOD -->
<files>src/app/api/auth/login/route.ts, prisma/schema.prisma</files>

<!-- BAD -->
<files>the auth files, relevant components</files>
```

### action
**What it is:** Specific implementation instructions, including what to avoid and WHY.

```xml
<!-- GOOD -->
<action>
  Create POST endpoint accepting {email, password}.
  Query User by email, compare password with bcrypt.
  On match, create JWT with jose library (15-min expiry).
  Return 200. On mismatch, return 401.
  Avoid: jsonwebtoken (CommonJS issues with Edge runtime)
</action>

<!-- BAD -->
<action>Add authentication</action>
```

### verify
**What it is:** How to prove the task is complete.

```xml
<!-- GOOD -->
<verify>curl -X POST localhost:3000/api/auth/login returns 200 with Set-Cookie header</verify>

<!-- BAD -->
<verify>It works</verify>
```

### done
**What it is:** Acceptance criteria - links to AC-N for traceability.

```xml
<!-- GOOD -->
<done>AC-1 satisfied: Valid credentials return 200 + JWT cookie</done>

<!-- BAD -->
<done>Authentication is complete</done>
```

**If you can't specify Files + Action + Verify + Done, the task is too vague.**

## Acceptance Criteria Format

Use Given/When/Then (BDD) format:

```gherkin
Given [precondition / initial state]
When [action / trigger]
Then [expected outcome]
```

**Guidelines:**
- Each criterion should be independently testable
- Include error states and edge cases
- Avoid implementation details (describe behavior, not code)
- Link tasks to criteria via `<done>AC-N satisfied</done>`

## Boundaries Section

Strict plans include explicit boundaries:

```markdown
<boundaries>
## DO NOT CHANGE
- database/migrations/* (schema locked for this phase)
- src/lib/auth.ts (auth system stable)

## SCOPE LIMITS
- This plan creates API only - no UI
- Do not add new dependencies
</boundaries>
```

Boundaries prevent scope creep by making off-limits areas explicit.

## Specificity Levels

### Too Vague
```xml
<task type="auto">
  <name>Add authentication</name>
  <files>???</files>
  <action>Implement auth</action>
  <verify>???</verify>
  <done>Users can authenticate</done>
</task>
```
AI Agent: "How? What type? What library? Where?"

### Just Right
```xml
<task type="auto">
  <name>Create login endpoint with JWT</name>
  <files>src/app/api/auth/login/route.ts</files>
  <action>
    POST endpoint accepting {email, password}.
    Query User by email, compare password with bcrypt.
    On match, create JWT with jose (15-min expiry).
    Return 200. On mismatch, return 401.
  </action>
  <verify>curl -X POST returns 200 with Set-Cookie header</verify>
  <done>AC-1 satisfied: Valid credentials → 200 + cookie</done>
</task>
```
AI Agent can implement immediately.

### Too Detailed
Writing the actual code in the plan. Trust AI Agent to implement from clear instructions.

## Sizing Guidance

**Good plan size:** 2-3 tasks, ~50% context usage, single concern.

**When to split into multiple plans:**
- Different subsystems (auth vs API vs UI)
- More than 3 tasks
- Risk of context overflow
- TDD candidates (separate plans)

**Prefer vertical slices:**
```
PREFER: Plan 01 = User (model + API + UI)
        Plan 02 = Product (model + API + UI)

AVOID:  Plan 01 = All models
        Plan 02 = All APIs
```

## Naming & Materialization

Plans are materialized in:
- `.agents/plans/`

Filename convention:
- `{PhaseNN}-{PlanNN}-{slug}.md`

Examples:
- `01-03-strict-planning-engine.md`
- `02-01-auth-session-hardening.md`

Dependency convention:
- `dependencies` MUST link to plan slugs.
- Example: `dependencies: ["01-02-strict-planning-ux"]`

## Anti-Patterns

**Vague actions:**
- "Set up the infrastructure"
- "Handle edge cases"
- "Make it production-ready"

**Unverifiable completion:**
- "It works correctly"
- "User experience is good"
- "Code is clean"

**Missing context:**
- "Use the standard approach"
- "Follow best practices"
- "Like the other endpoints"

**Reflexive dependencies:**
```yaml
# BAD - chaining just because sequential
dependencies: ["01-01-setup"]  # Plan does not actually need this slug output

# GOOD - genuine dependency
dependencies: ["01-01-user-model"]  # Plan imports artifacts from this slug
```

</plan_format>
