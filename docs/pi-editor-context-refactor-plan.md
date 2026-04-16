---
phase: 04-pi-editor-context-refactor
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - docs/pi-editor-context-refactor-plan.md
  - package.json
  - tests/pi-editor-context/cases.mjs
  - tests/pi-editor-context/run.mjs
  - scripts/pi-editor-context.mjs
  - scripts/pi-editor-context/utils.mjs
  - scripts/pi-editor-context/config.mjs
  - scripts/pi-editor-context/session-core.mjs
  - scripts/pi-editor-context/session-discovery.mjs
  - scripts/pi-editor-context/context-core.mjs
  - scripts/pi-editor-context/editor-open.mjs
  - scripts/pi-editor-context/workflow.mjs
autonomous: true
---

<objective>
## Goal
Refactor `scripts/pi-editor-context.mjs` (currently monolithic) into domain modules while preserving runtime behavior, exported API contract, and operator workflow semantics.

## Purpose

Reduce maintenance risk and cognitive load without changing what already works in production. Preserve user confidence by adding test safety nets before structural movement.

## Output

1. A documented, executable refactor path (this file).
2. Expanded deterministic test harness covering high-risk workflow behavior.
3. Modularized implementation under `scripts/pi-editor-context/`.
4. Stable facade entrypoint in `scripts/pi-editor-context.mjs`.
5. Follow-up simplification pass (Phase B) for `editor-open` duplication.
   </objective>

<context>
- Current state:
  - `scripts/pi-editor-context.mjs` is ~1500+ LOC and mixes config resolution, session discovery, JSONL parsing, branch selection, context formatting, editor routing (`nvr`/`nvim`), fallback policy, and orchestration.
  - Existing deterministic tests pass (6/6) and already validate critical core behavior.
- Confirmed constraints from technical spec and prior implementation:
  - Keep PI integration contract intact (`cmd = { "pi" }` in Sidekick; wrapper flow unchanged).
  - Keep marker contract intact:
    - `<!-- PI_CONTEXT_START -->`
    - `<!-- PI_CONTEXT_END -->`
    - `<!-- PI_PROMPT_START -->`
  - Preserve soft-fail behavior by default.
  - Keep generated artifacts in English.
- Refactor strategy agreed in design review:
  - Two phases:
    - **Phase A:** extraction/movement without behavior changes.
    - **Phase B:** internal simplification (especially `openEditor`) after Phase A is green.
  - Keep `scripts/pi-editor-context.mjs` as stable facade during transition.
  - Freeze current public exports to avoid breaking tests/integrations.
- Existing test harness entrypoint:
  - `node tests/pi-editor-context/run.mjs`
- Required quality gates per implementation step:
  - Test harness passes.
  - Lint passes.
</context>

<acceptance_criteria>

## AC-1: Safety-Net Expansion Before Refactor

Given the current working implementation
When the safety-net step is executed
Then tests exist for editor mode routing and working-file lifecycle behavior not covered by the original 6 cases.

## AC-2: Standardized Test Command

Given a contributor uses default project scripts
When `npm test` is executed
Then it runs the PI editor-context deterministic harness and fails on regressions.

## AC-3: Stable Public API During Phase A

Given existing imports from `scripts/pi-editor-context.mjs`
When Phase A refactor completes
Then exported names and observable behavior remain compatible.

## AC-4: Domain-Oriented Module Boundaries

Given the modularized implementation
When reviewing dependencies
Then module direction is enforced: low-level modules do not depend on workflow/orchestration modules.

## AC-5: Behavior-Preserving Extraction

Given baseline tests and new safety tests
When code is moved from monolith to domain modules
Then all tests pass with no accepted regressions in runtime contract.

## AC-6: Phase B Is Explicit and Trackable

Given Phase A completion
When reviewing repository documentation
Then pending simplification work for `editor-open` is explicitly documented and actionable (not implicit memory).

## AC-7: Verification Evidence Is Reproducible

Given plan execution completion
When another agent/operator re-runs commands
Then they can reproduce passing checks using documented commands only.
</acceptance_criteria>

<tasks>
<task type="auto">
  <name>Expand deterministic safety net for high-risk workflow branches</name>
  <files>tests/pi-editor-context/cases.mjs, tests/pi-editor-context/run.mjs</files>
  <action>
    Add new deterministic cases covering the refactor risk areas while avoiding live tmux/Neovim dependencies.

    Required additions:
    1) Validate editor routing decisions in orchestrated flow via injected `openEditorImpl` stubs:
       - auto-like success path reports expected `editorDecision` metadata shape.
       - fallback path in soft mode is invoked for non-connection-loss failures.
    2) Validate working file lifecycle:
       - `workingMode=temp` removes temporary working directory after successful export.
       - `workingMode=persistent` keeps the working file path for inspection.
    3) Validate prompt-only export still holds in fallback-with-working-file scenarios.

    Implementation notes:
    - Keep tests deterministic and fixture-based.
    - Do not require actual `nvr`, tmux, or interactive editor sessions.
    - Reuse existing assertion helpers in `cases.mjs`.
    - Keep case naming explicit and AC-linked.

  </action>
  <verify>node tests/pi-editor-context/run.mjs</verify>
  <done>AC-1 satisfied: new high-risk workflow tests exist and pass.</done>
</task>

<task type="auto">
  <name>Standardize local test command and preserve existing harness usage</name>
  <files>package.json</files>
  <action>
    Replace placeholder `npm test` script with deterministic harness command:
    - `"test": "node tests/pi-editor-context/run.mjs"`

    Keep existing lint scripts unchanged.
    Do not add dependencies.

  </action>
  <verify>npm test</verify>
  <done>AC-2 satisfied: default test command executes real harness.</done>
</task>

<task type="auto">
  <name>Phase A modular extraction with stable facade and frozen exports</name>
  <files>scripts/pi-editor-context.mjs, scripts/pi-editor-context/utils.mjs, scripts/pi-editor-context/config.mjs, scripts/pi-editor-context/session-core.mjs, scripts/pi-editor-context/session-discovery.mjs, scripts/pi-editor-context/context-core.mjs, scripts/pi-editor-context/editor-open.mjs, scripts/pi-editor-context/workflow.mjs</files>
  <action>
    Extract monolith into domain modules with behavior-preserving movement first.

    Target module responsibilities:
    - `utils.mjs`: generic helpers (type coercion, EOL normalization, truncation, safe json, fs probes, shell command availability).
    - `config.mjs`: defaults, marker constants, config layer precedence, source metadata.
    - `session-core.mjs`: JSONL parse, timestamp/id helpers, branch leaf selection, message text extraction.
    - `session-discovery.mjs`: sessions root resolution, bucket strategy, session file discovery details.
    - `context-core.mjs`: context construction/formatting, working-file build, prompt extraction.
    - `editor-open.mjs`: nvr target resolution + open behavior (moved as-is in Phase A).
    - `workflow.mjs`: `runEditorContext` orchestration and fallback policy.

    Facade constraints for `scripts/pi-editor-context.mjs`:
    - Keep CLI entrypoint behavior unchanged.
    - Re-export current public API names unchanged.
    - Keep backward-compatible import path for tests and launcher.

    Dependency-direction constraint:
    - `workflow.mjs` may import lower-level modules.
    - Lower-level modules must not import `workflow.mjs`.

    IMPORTANT (Phase A):
    - No intentional behavior changes.
    - Do not simplify `openEditor` internals yet; move logic first.

  </action>
  <verify>node tests/pi-editor-context/run.mjs && npm run lint</verify>
  <done>AC-3, AC-4, AC-5 satisfied: modular extraction is complete with stable API and passing checks.</done>
</task>

<task type="auto">
  <name>Phase B simplification checkpoint for editor-open duplication</name>
  <files>scripts/pi-editor-context/editor-open.mjs, scripts/pi-editor-context.mjs, docs/pi-editor-context-refactor-plan.md</files>
  <action>
    After Phase A is green, execute controlled simplification of `editor-open.mjs`.

    Required simplifications:
    1) Unify nvr argument/metadata construction in single helpers.
    2) Unify normal and retry-on-connection-loss flow to reduce duplicated branches.
    3) Centralize nvim fallback in one path.
    4) Preserve observable contract fields:
       - `effectiveMode`
       - `fallbackFrom`
       - `nvrRetry`
       - routing/debug metadata consumed by logs and tests.

    Update this plan checklist statuses (`[ ]` -> `[x]`) as each Phase B item is completed.

  </action>
  <verify>npm test && npm run lint</verify>
  <done>AC-6, AC-7 satisfied: Phase B work is explicit, completed, and reproducibly verified.</done>
</task>
</tasks>

<boundaries>
## DO NOT CHANGE
- `scripts/pi-editor-context` launcher command identity and invocation semantics.
- Marker strings and prompt export contract.
- Sidekick PI command identity assumptions (`cmd = { "pi" }`) in documented workflow.
- Default soft error behavior semantics.

## SCOPE LIMITS

- No changes to PI upstream internals.
- No new dependencies.
- No redesign of context extraction rules beyond behavior-preserving refactor.
- No interactive tmux/Neovim integration tests in this plan (deterministic harness only).
  </boundaries>

<verification>
Run in this exact order:

1. Baseline before modifications

```bash
node tests/pi-editor-context/run.mjs
npm run lint
```

2. After Task 1 (safety net)

```bash
node tests/pi-editor-context/run.mjs
```

3. After Task 2 (test script standardization)

```bash
npm test
```

4. After each extraction block in Task 3

```bash
node tests/pi-editor-context/run.mjs
npm run lint
```

5. After Phase B (Task 4)

```bash
npm test
npm run lint
```

Evidence requirements:

- Include pass/fail summary from test harness.
- Include lint exit result.
- If any temporary failure occurs during extraction, include rollback/fix note in SUMMARY.
  </verification>

<success_criteria>

- All ACs (AC-1..AC-7) are satisfied.
- `npm test` is meaningful and green.
- `scripts/pi-editor-context.mjs` is no longer monolithic and functions as stable facade/entrypoint.
- New module boundaries are clear and dependency-safe.
- Phase B simplification items are explicitly tracked and completed.
  </success_criteria>

<output>
Produce `SUMMARY.md` with this exact structure:

1. **Scope Executed**
   - List each task executed and file paths touched.
2. **Safety Net Additions**
   - Enumerate each new test case and what behavior it protects.
3. **Modularization Result**
   - Show final module map and responsibility of each module.
4. **Compatibility Validation**
   - Confirm public exports preserved and launcher behavior unchanged.
5. **Verification Evidence**
   - Paste command list and summarized outputs (`npm test`, harness summary, lint).
6. **Phase B Simplification Log**
   - Item-by-item status and notable implementation notes.
7. **Residual Risks / Follow-ups**
   - Any remaining technical debt or non-blocking risks.
     </output>

---

## Execution Checklist (update while implementing)

### Phase A — Safety + Extraction

- [x] A1: Add safety-net tests for workflow/editor routing and working lifecycle.
- [x] A2: Set `npm test` to deterministic harness.
- [x] A3: Extract `context-core` module and keep tests green.
- [x] A4: Extract `config` module and keep tests green.
- [x] A5: Extract `session-discovery` + `session-core` modules and keep tests green.
- [x] A6: Extract `editor-open` module as-is (no simplification yet) and keep tests green.
- [x] A7: Extract `workflow` and convert `scripts/pi-editor-context.mjs` into stable facade.

### Phase B — Simplification (post-Phase-A only)

- [ ] B1: Unify nvr arg + metadata construction helpers.
- [ ] B2: Unify nvr normal/retry flow.
- [ ] B3: Centralize nvim fallback path.
- [ ] B4: Re-verify observable output contract fields remain unchanged.
- [ ] B5: Run full verification and update SUMMARY evidence.
