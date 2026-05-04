# PLAN.md Template

Template for `.agents/plans/{PhaseNN}-{PlanNN}-{slug}.md` - executable plan artifacts.

**Naming:** `{PhaseNN}-{PlanNN}-{slug}.md` (e.g., `01-03-strict-planning-engine.md`)

---

## File Template

````markdown
---
title: "[Human readable plan title]"
phase: "NN-[phase-name]"
plan: "NN"
date: "YYYY-MM-DD"
status: "pending"
type: "execute" # execute | tdd | research
dependencies: [] # plan slugs, e.g. ["01-02-strict-planning-ux"]
---

<objective>
## Goal
[What this plan accomplishes - specific, measurable]

## Purpose

[Why this matters for the project and current implementation scope]

## Output

[What artifacts will be created/modified]
</objective>

<context>
## Technical Interview Context
docs/technical-interviews/<slug>_log.md
docs/technical-interviews/<slug>_plan.md

## Prior Work (only if genuinely needed)

# Only reference prior SUMMARYs if:

# - This plan imports types/exports from a prior plan

# - A prior plan made a decision affecting this plan

# - Prior plan output is direct input to this plan

#

# Do NOT reflexively chain dependencies without real coupling.

## Source Files

path/to/relevant/source.ts
</context>

<acceptance_criteria>

## AC-1: [Criterion Name]

```gherkin
Given [precondition / system state]
When [user action / trigger]
Then [expected outcome / observable result]
```

## AC-2: [Criterion Name]

```gherkin
Given [precondition]
When [action]
Then [outcome]
```

## AC-3: [Criterion Name]

```gherkin
Given [precondition]
When [action]
Then [outcome]
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: [Action-oriented name]</name>
  <files>path/to/file.ext, another/file.ext</files>
  <action>
    [Specific implementation instructions]
    - What to do
    - How to do it
    - What to avoid and WHY
  </action>
  <verify>[Command or check to prove it worked]</verify>
  <done>[Measurable acceptance criteria - links to AC-N]</done>
</task>

<task type="auto">
  <name>Task 2: [Action-oriented name]</name>
  <files>path/to/file.ext</files>
  <action>[Specific implementation]</action>
  <verify>[Command or check]</verify>
  <done>[Acceptance criteria]</done>
</task>

<task type="checkpoint:decision" gate="blocking">
  <decision>[What needs deciding]</decision>
  <context>[Why this decision matters now]</context>
  <options>
    <option id="option-a">
      <name>[Option name]</name>
      <pros>[Benefits and advantages]</pros>
      <cons>[Tradeoffs and limitations]</cons>
    </option>
    <option id="option-b">
      <name>[Option name]</name>
      <pros>[Benefits and advantages]</pros>
      <cons>[Tradeoffs and limitations]</cons>
    </option>
  </options>
  <resume-signal>Select: option-a or option-b</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>[What was built that needs verification]</what-built>
  <how-to-verify>
    1. Run: [command to start]
    2. Visit: [URL or location]
    3. Test: [Specific interactions]
    4. Confirm: [Expected behaviors]
  </how-to-verify>
  <resume-signal>Type "approved" to continue, or describe issues to fix</resume-signal>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE

- [Protected file or pattern]
- [Another protected element]

## SCOPE LIMITS

- [What's explicitly out of scope for this plan]
- [Another exclusion]

</boundaries>

<verification>
Before declaring plan complete:
- [ ] [Specific test command]
- [ ] [Build/type check passes]
- [ ] [Behavior verification]
- [ ] All acceptance criteria met
</verification>

<success_criteria>

- All tasks completed
- All verification checks pass
- No errors or warnings introduced
- [Plan-specific criteria]
</success_criteria>

<output>
After completion, create `.agents/plans/{PhaseNN}-{PlanNN}-{slug}-SUMMARY.md`
</output>

````

---

## Frontmatter Fields

| Field          | Required | Purpose                                                                   |
| -------------- | -------- | ------------------------------------------------------------------------- |
| `title`        | Yes      | Human-readable plan title                                                 |
| `phase`        | Yes      | Phase identifier (e.g., `01-strict-planning`)                             |
| `plan`         | Yes      | Plan number within phase (e.g., `01`, `02`)                               |
| `date`         | Yes      | Plan creation date in ISO format (`YYYY-MM-DD`)                           |
| `status`       | Yes      | Initial status for new plans (`pending`)                                  |
| `type`         | Yes      | `execute` for standard, `tdd` for test-driven, `research` for exploration |
| `dependencies` | Yes      | Array of dependency plan slugs required by this plan                      |

---

## Task Types

| Type                      | Use For                                      | Behavior                                                |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------- |
| `auto`                    | Everything AI can do independently           | Fully autonomous execution                              |
| `checkpoint:decision`     | Implementation choices requiring human input | Pauses, presents options, waits for selection           |
| `checkpoint:human-verify` | Visual/functional verification               | Pauses, presents verification steps, waits for approval |
| `checkpoint:human-action` | Truly unavoidable manual steps (rare)        | Pauses, describes action, waits for confirmation        |

---

## Task Structure Requirements

Every `auto` task MUST have:

- `<name>` - Action-oriented, describes outcome
- `<files>` - Which files created/modified
- `<action>` - Specific implementation (what to do, what to avoid)
- `<verify>` - How to prove it worked (command, check)
- `<done>` - Acceptance criteria (links to AC-N)

**If you can't specify Files + Action + Verify + Done, the task is too vague.**

---

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

---

## Scope Guidance

**Plan sizing:**

- 2-3 tasks per plan maximum
- ~50% context usage target
- Single concern per plan

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
        Plan 03 = All UIs
```

---

## Parallel Execution

**Parallel candidates:**

- `dependencies: []` - No dependency slugs required
- No file conflicts with other candidate plans

**Sequential (genuine dependency):**

- `dependencies: ["01-01-foundation-setup"]` - Requires prior plan output
- Uses types/exports created by prior plan
- Prior plan makes decision affecting this plan

**Do NOT reflexively chain:** adding dependencies without real coupling creates false sequential execution.

---

## Anti-Patterns

**Vague tasks:**

```xml
<!-- BAD -->
<task type="auto">
  <name>Set up authentication</name>
  <action>Add auth to the app</action>
</task>

<!-- GOOD -->
<task type="auto">
  <name>Create login endpoint with JWT</name>
  <files>src/api/auth/login.ts, src/lib/jwt.ts</files>
  <action>
    Create POST /api/auth/login endpoint:
    - Accept { email, password } body
    - Validate against User model with bcrypt compare
    - Return JWT token on success (15min expiry)
    - Return 401 on invalid credentials
    Avoid: Storing plaintext passwords, using weak JWT secrets
  </action>
  <verify>curl -X POST /api/auth/login returns JWT token</verify>
  <done>AC-1 satisfied: User can authenticate with valid credentials</done>
</task>
```

**Reflexive dependencies:**

```yaml
# BAD - chaining just because sequential
dependencies: ["01-01-foundation-setup"]  # Plan doesn't actually need this slug output

# GOOD - genuine dependency
dependencies: ["01-01-user-model"]  # Plan imports artifacts from this slug
```

**Missing boundaries:**

```markdown
<!-- BAD - no protection -->

<tasks>...</tasks>

<!-- GOOD - explicit boundaries -->
<boundaries>
## DO NOT CHANGE
- database/migrations/* (schema locked for this phase)
- src/lib/auth.ts (auth system stable)
</boundaries>
```
