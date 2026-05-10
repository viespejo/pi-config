---
title: "Adapt /plan:list UX for diagnostics-first navigation"
phase: "04-edge-cases"
plan: "01"
date: "2026-05-10"
status: "pending"
type: "execute"
dependencies: []
---

<objective>
## Goal
Adapt `/plan:list` so the main navigable list contains only real plans, while integrity issues (dependency cycles and unresolved dependencies) are surfaced in dedicated, non-navigable diagnostic sections at the end of the view.

## Purpose

The listing view is the daily operational entry point for discovering, filtering, executing, and archiving plans. Mixing synthetic "missing" nodes and hidden cyclic components into the navigable tree degrades usability. Separating diagnostics from navigation keeps the primary flow clean while preserving full visibility of integrity problems.

## Output

Modified `lib/plan-selector.ts` and `lib/dependencies.ts` with:

- Forest building that excludes synthetic missing nodes from navigation.
- Cycle detection across all plans producing explicit chain data.
- Unresolved dependency grouping by missing target.
- Two conditional diagnostic sections rendered at the end of the view.
  </objective>

<context>
## Technical Interview Context
docs/technical-interviews/plan-list-ux-adaptation_log.md
docs/technical-interviews/plan-list-ux-adaptation_plan.md

## Source Files

lib/plan-selector.ts
lib/dependencies.ts
commands/list-plans.ts
lib/types.ts
</context>

<acceptance_criteria>

## AC-1: Main list excludes synthetic missing nodes

```gherkin
Given plans with dependencies pointing to non-existent slugs
When /plan:list renders
Then the main navigable list includes only real plans and no synthetic "missing" nodes appear in navigation or selection
```

## AC-2: Cyclic plans diagnostic section

```gherkin
Given at least one dependency cycle exists among plans
When /plan:list renders
Then a "Cyclic plans" section appears after the main list with explicit cycle chains (e.g. 03-02 -> 03-03 -> 03-02), cycle length, ordered shortest-first then lexical tie-break, using slug as primary label with title in parentheses when available, styled with warning/error-soft cues
```

## AC-3: Unresolved dependencies diagnostic section

```gherkin
Given at least one dependency references a non-existent plan
When /plan:list renders
Then an "Unresolved dependencies" section appears after the main list grouped by missing dependency with impacted plans listed, ordered by highest impact first then lexical tie-break, using slug (title) label convention, with +N more overflow for long lists, styled with dim+warning cues
```

## AC-4: Diagnostic sections are conditional

```gherkin
Given no cycles and no unresolved dependencies exist
When /plan:list renders
Then no diagnostic sections appear in the view
```

## AC-5: Diagnostic sections are non-navigable

```gherkin
Given diagnostic sections are rendered
When the user navigates with keyboard (↑/↓, Enter)
Then only main plan list items receive focus and selection; diagnostic lines are never selectable
```

## AC-6: Terminal statuses remain visible

```gherkin
Given plans with terminal statuses (completed, cancelled, abandoned)
When /plan:list renders with default settings
Then all terminal-status plans appear in the main list without auto-hiding
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: Refactor forest building and add diagnostic data computation</name>
  <files>lib/plan-selector.ts, lib/dependencies.ts</files>
  <action>
    In `lib/plan-selector.ts`:
    - Remove the `getOrCreateMissing` helper from `buildPlanForest`.
    - When a dependency slug does not match any real plan, skip the parent-child edge instead of creating a synthetic node.
    - Remove the `missing` field from `PlanTreeNode` interface and all downstream filtering/styling that references it (e.g., the `"missing"` status entries in `orderedStatuses` arrays).
    - Plans that only exist inside dependency cycles (no root path) must still appear: after building the forest from root nodes, iterate remaining unvisited real plans and attach them as additional roots so they are not lost.

    In `lib/dependencies.ts`:
    - Add `findAllCycles(plans: PlanInfo[]): CycleInfo[]` that detects all distinct cycle components across all plans. Each `CycleInfo` contains `chain: string[]` (e.g., `["03-02", "03-03", "03-02"]`) and `length: number` (unique nodes in cycle). Use Tarjan's or iterative DFS with visited tracking.
    - Add `findUnresolvedDeps(plans: PlanInfo[]): UnresolvedGroup[]` that returns `{ missingSlug: string; impactedSlugs: string[] }[]`, grouped by missing dependency, ordered by `impactedSlugs.length` descending then lexical on `missingSlug`.
    - Export both functions and their return types.

    Avoid: modifying `findDependencyCycle` (existing single-slug API) — add new functions alongside it to preserve backward compatibility.

  </action>
  <verify>
    - Unit test: `buildPlanForest` with a missing dependency produces no synthetic nodes; the plan referencing it still appears as a root.
    - Unit test: `buildPlanForest` with a pure cycle (A→B→A) includes both A and B as roots.
    - Unit test: `findAllCycles` detects cycles of length 2 and 3, returns sorted by shortest first.
    - Unit test: `findUnresolvedDeps` groups correctly and orders by impact descending.
  </verify>
  <done>AC-1 satisfied: no synthetic missing nodes in navigable forest. AC-2/AC-3 data layer ready. AC-4 implicitly supported (empty arrays when no issues). AC-5 supported (diagnostic data never enters selectable node list).</done>
</task>

<task type="auto">
  <name>Task 2: Render Cyclic plans and Unresolved dependencies diagnostic sections</name>
  <files>lib/plan-selector.ts</files>
  <action>
    In `PlanSelector.render()`:
    - After main plan items and before the shortcut footer, conditionally render two diagnostic blocks.

    Cyclic plans block (only if `findAllCycles` returns non-empty):
    - Render a dim header line: `⚠ Cyclic plans`.
    - For each cycle, render one line: `  slug-a (Title A) → slug-b (Title B) → slug-a  [len: N]`.
    - Use slug as primary label; append `(title)` in parentheses when `plan.title` is available.
    - Order: shortest cycle first, then lexical tie-break on first slug.
    - Style: `theme.fg("warning", ...)` for chain text.

    Unresolved dependencies block (only if `findUnresolvedDeps` returns non-empty):
    - Render a dim header line: `⚠ Unresolved dependencies`.
    - For each group, render: `  missing-slug ← slug-a (Title A), slug-b (Title B)`.
    - If impacted list exceeds 3 entries, truncate to first 3 and append `+N more`.
    - Order: highest impact count first, then lexical on missing slug.
    - Style: `theme.fg("dim", missingSlug)` + `theme.fg("warning", impactedList)`.

    Both blocks:
    - Lines are appended to `lines[]` but are NOT added to `flatItems` or `selectableNodes`, ensuring they are non-navigable.
    - Omitted entirely when their respective data arrays are empty.

    Call `findAllCycles` and `findUnresolvedDeps` once per `refreshView()` and cache results on the instance.

    Avoid: making diagnostic lines part of the scroll viewport calculation for `visibleLines()` — they render below the scrollable area, between the last plan item separator and the footer.

  </action>
  <verify>
    - Snapshot test: render output with one cycle shows "⚠ Cyclic plans" header and formatted chain line.
    - Snapshot test: render output with unresolved deps shows "⚠ Unresolved dependencies" with grouped lines.
    - Snapshot test: render output with 5+ impacted plans shows `+N more` overflow.
    - Snapshot test: render output with no issues shows no diagnostic sections.
    - Navigation test: keyboard ↑/↓ never selects diagnostic lines.
  </verify>
  <done>AC-2 satisfied: cyclic plans rendered with chains, length, ordering, labels, and styling. AC-3 satisfied: unresolved deps rendered with grouping, ordering, overflow, labels, and styling. AC-4 satisfied: conditional rendering. AC-5 satisfied: non-navigable.</done>
</task>

<task type="auto">
  <name>Task 3: Verify terminal status visibility and cleanup stale missing-status references</name>
  <files>lib/plan-selector.ts</files>
  <action>
    - Remove `"missing"` from all `orderedStatuses` arrays in `buildGroupedViewByStatus` and `groupNodesByStatus`.
    - Confirm that no default filtering or hiding logic is applied to terminal statuses (`completed`, `cancelled`, `abandoned`) in `refreshView()` or `buildGroupedViewByStatus`.
    - Ensure `styleStatus` no longer includes a `case "missing"` branch; remove it.
    - Verify the `selectableNodes` filter no longer references `node.missing` (since the field is removed in Task 1).

    Avoid: introducing any temporal auto-hiding logic in this plan — that is deferred per interview decision DEC-007/DEC-008.

  </action>
  <verify>
    - Unit test: plans with status `completed`, `cancelled`, `abandoned` appear in default `refreshView()` output.
    - Grep for `missing` in `plan-selector.ts` confirms no remaining references to the removed field or status.
  </verify>
  <done>AC-6 satisfied: terminal statuses visible by default. AC-1 reinforced: no stale missing-node references remain.</done>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE

- commands/list-plans.ts (command wiring is stable; changes are internal to selector and dependencies)
- lib/plan-service.ts (plan loading logic is out of scope)
- lib/domain/lifecycle.ts (status transition rules are out of scope)
- Existing `findDependencyCycle` function signature in lib/dependencies.ts (backward compatibility)

## SCOPE LIMITS

- No temporal auto-hiding of terminal statuses (deferred to future plan per DEC-007/DEC-008)
- No changes to `/plan:save` behavior
- No changes to plan execution flow
- Diagnostic sections are informational only — no interactive actions on diagnostic lines

</boundaries>

<verification>
Before declaring plan complete:
- [ ] All unit tests pass for `buildPlanForest`, `findAllCycles`, `findUnresolvedDeps`
- [ ] Snapshot tests pass for diagnostic section rendering (cycles, unresolved, empty, overflow)
- [ ] Navigation tests confirm keyboard focus never enters diagnostic sections
- [ ] Manual smoke check with: (1) normal acyclic set, (2) pure cyclic component (03-02/03-03), (3) unresolved deps with high fan-out, (4) mixed terminal statuses
- [ ] `grep -n "missing" lib/plan-selector.ts` returns no stale references to removed field
- [ ] All acceptance criteria AC-1 through AC-6 verified
</verification>

<success_criteria>

- All tasks completed with passing tests
- No synthetic missing nodes appear in navigable plan list
- Cyclic and unresolved dependency diagnostics render correctly and conditionally
- Terminal statuses remain visible by default
- No regressions in existing plan selection, search, grouping, or archive flows
  </success_criteria>

<output>
After completion, create `.agents/plans/04-01-plan-list-ux-adaptation-SUMMARY.md`
</output>
