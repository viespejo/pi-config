---
phase: 02-pi-editor-modes
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/pi-editor.mjs
  - scripts/pi-editor-lib/editor-open.mjs
  - extensions/files.ts
  - tests/pi-editor/cases.mjs
autonomous: true
---

<objective>
## Goal
Introduce a first-class `--mode diff` in `pi-editor`, keep `context` as default, keep `plain` as generic passthrough, add `--no-wait` for plain runtime control, and remove mode-ambiguity from caller workflows (especially `extensions/files.ts`) without changing existing diff behavior semantics.

## Purpose
Current behavior is functionally correct but hard to reason about because diff behavior is inferred inside `plain` mode (e.g., `-d` argument shape). A dedicated `diff` mode makes intent explicit, reduces branching complexity, and keeps compatibility of core editor-open semantics.

## Output
- `pi-editor` CLI supports `--mode diff` with strict parsing.
- `pi-editor` CLI supports `--mode plain --no-wait ...` as runtime option (plain-only).
- `openDiffEditor(...)` exists as dedicated editor-open entrypoint.
- `extensions/files.ts` uses `pi-editor --mode diff` for diff action and `--no-wait` for reveal path with pi-editor.
- Test suite reflects new contracts and removes misleading plain-diff implication.
</objective>

<context>
Decisions fixed in prior discussion:
- Modes and meaning:
  - `context` (default): existing context workflow, unchanged.
  - `plain`: open editor without context; remains passthrough and accepts extra args.
  - `diff`: explicit two-file diff workflow.
- `plain` remains open to caller use-cases (no hard blocking of `-d`).
- Add plain runtime flag: `--no-wait` (plain-only), consumed by CLI (not forwarded as editor arg).
- `--no-wait` applies to both plain single-path and plain passthrough paths; only affects nvr route (nvim remains process-blocking).
- Initial caller usage: `extensions/files.ts` reveal flow should use `--no-wait` when invoking `pi-editor`.
- `diff` parser is strict:
  - valid: `pi-editor --mode diff <old> <new>`
  - valid: `pi-editor --mode diff <old> <new> -- <extraArgs...>`
  - invalid otherwise -> usage error (exit code 2).
- Preserve all current diff UX/behavior:
  - readonly old/left side,
  - focus/right-side workflow,
  - `stopinsert`,
  - coordinated close behavior,
  - current nvr send-and-forget semantics for diff (`remote-silent`).
- Decision contract shape remains stable (`requestedMode`, `effectiveMode`, `waitMode`, fallback/routing metadata).
- Existing tests currently pass; refresh stale ones that imply diff belongs to plain mode.
</context>

<acceptance_criteria>
## AC-1: Explicit mode routing contract is clear
Given `pi-editor` is called with mode flags
When user calls `--mode context`, `--mode plain`, or `--mode diff`
Then each mode routes to its own explicit pipeline and default invocation still routes to `context`.

## AC-2: Diff mode parser is strict and deterministic
Given `pi-editor --mode diff` invocation
When args match `<old> <new> [-- <extraArgs...>]`
Then diff opens via dedicated diff path; otherwise CLI returns usage and exits with code 2.

## AC-2b: Plain no-wait runtime option is explicit and constrained
Given `pi-editor --mode plain` invocation
When `--no-wait` is provided
Then the flag is consumed by CLI (not passed through), only accepted for plain mode, and plain open path requests no-wait behavior for nvr-backed opens.

## AC-3: Diff behavior parity is preserved
Given diff mode opens through nvim/nvr
When user invokes diff
Then existing diff UX behaviors and wait semantics remain unchanged (including nvr non-blocking diff behavior).

## AC-4: Files extension uses explicit diff mode and reveal no-wait
Given `/files` actions and selected editor command resolves to `pi-editor`
When diff action runs
Then command uses `pi-editor --mode diff <old> <new>` (plus optional extras after `--` when applicable), not plain-inferred diff.
And when reveal action runs
Then command uses `pi-editor --mode plain --no-wait ...` so reveal is not blocked waiting for remote close.

## AC-5: Test suite documents the new contract and removes stale implications
Given `tests/pi-editor/cases.mjs`
When test run completes
Then it includes dedicated `--mode diff` coverage and plain tests no longer imply diff is a plain-mode responsibility.
</acceptance_criteria>

<tasks>
<task type="auto">
  <name>Add dedicated diff mode routing and strict CLI parsing</name>
  <files>scripts/pi-editor.mjs</files>
  <action>
    Update CLI parsing and routing:
    1) Extend mode set to `context|plain|diff`.
    2) Keep default mode as `context` (legacy invocation unchanged).
    3) Keep `plain` behavior as generic passthrough with at least one arg.
    3b) Add plain-only runtime option `--no-wait`:
       - accepted as `pi-editor --mode plain [--no-wait] <editorArgs...>`.
       - consumed by CLI (removed from forwarded args).
       - rejected in non-plain modes with usage error (exit 2).
    4) Add strict diff parser contract:
       - Accept exactly `<old> <new>` before optional `--` separator.
       - If `--` is present, everything after it is `extraArgs` (can be empty).
       - Treat `--mode diff <old> <new> --` as valid with `extraArgs=[]`.
       - Reject malformed forms (missing old/new, misplaced separator, extra positional args before `--`).
    5) Add/route through `runDiffEditor(...)` from `runPiEditor(...)`.
    6) Update usage text to include all 3 modes with explicit syntax examples.
    7) Preserve `usageError` + exit code 2 behavior for invalid input.
    Avoid introducing context-mode logic changes and avoid hidden fallback parsing in diff mode.
  </action>
  <verify>node tests/pi-editor/run.mjs (must pass diff/new parser cases and existing context/plain cases)</verify>
  <done>AC-1 satisfied, AC-2 satisfied, AC-2b satisfied</done>
</task>

<task type="auto">
  <name>Centralize diff open behavior in editor layer without semantic regressions</name>
  <files>scripts/pi-editor-lib/editor-open.mjs</files>
  <action>
    Introduce a dedicated API:
    - `openDiffEditor(oldFilePath, newFilePath, extraArgs, config, env)`.

    Implementation requirements:
    1) Build diff editor args internally from explicit old/new inputs and optional extras.
    2) Reuse existing diff command-building logic so behavior parity is preserved:
       - nvim standalone diff setup,
       - nvr passthrough diff setup,
       - readonly old window,
       - stopinsert/focus behavior,
       - autocmd close coupling behavior.
    3) Keep existing nvr diff wait behavior (`remote-silent`) and existing nvim process wait behavior.
    4) Keep existing decision object contract fields and metadata shapes stable.
    5) Keep `openEditorArgs(...)` available for plain passthrough; do not remove plain flexibility.
    6) Export new function and wire it for use by CLI diff mode.
    7) Add runtime no-wait option plumbing for plain opens:
       - support plain single-file (`openEditor`) and plain passthrough (`openEditorArgs`).
       - no-wait changes nvr wait behavior only.
       - nvim behavior remains process-based.

    Refactor only as needed to avoid duplicated diff assembly logic between `openEditorArgs` and `openDiffEditor`.
  </action>
  <verify>node tests/pi-editor/run.mjs plus targeted grep/read check that `openDiffEditor` is exported and used by CLI path</verify>
  <done>AC-3 satisfied, AC-2b satisfied</done>
</task>

<task type="auto">
  <name>Migrate files extension diff invocation and refresh tests to contract-oriented coverage</name>
  <files>extensions/files.ts, tests/pi-editor/cases.mjs</files>
  <action>
    In `extensions/files.ts`:
    1) Update pi-editor diff command construction to call explicit mode:
       - `pi-editor --mode diff <old> <new>`.
       - If no real source of extra args exists in `/files` flow, do not add new plumbing; call without `--` extras.
       - If extras are already available naturally, append as `-- <extraArgs...>`.
    2) For reveal flow when executable is `pi-editor`, include plain no-wait invocation (`--mode plain --no-wait ...`) to avoid blocking on remote close.
    3) Preserve non-pi-editor editor behavior branches (vim-like `-d`, code `--diff`, generic fallback).
    4) Preserve existing plain usage for non-diff open/edit operations.

    In `tests/pi-editor/cases.mjs`:
    1) Add tests for `--mode diff` routing to dedicated diff path.
    2) Add tests for strict valid forms:
       - `--mode diff old new`
       - `--mode diff old new -- <extras...>` extras preserved.
       - `--mode diff old new --` accepted with empty extras.
    3) Add tests for invalid diff forms returning usage/exit-2 behavior.
       - Assert both usage text emission and process exit code `2` in CLI-level invalid-usage coverage.
    4) Add tests for plain `--no-wait` behavior:
       - plain accepts `--no-wait` and does not forward it as editor arg.
       - `--no-wait` rejected outside plain mode with usage/exit-2.
       - reveal command path builds `pi-editor --mode plain --no-wait ...` when pi-editor is selected.
    5) Keep existing context/plain contract tests.
    6) Update stale plain passthrough test input away from `-d a b` to neutral args (e.g., editor flags + single file) so suite does not imply diff belongs to plain.

    Ensure assertions remain contract-level (observable behavior), not tied to transient internals.
  </action>
  <verify>node tests/pi-editor/run.mjs and confirm all tests green; verify edited test names/descriptions align with new mode responsibilities</verify>
  <done>AC-4 satisfied, AC-5 satisfied, AC-2b satisfied</done>
</task>
</tasks>

<boundaries>
## DO NOT CHANGE
- Context workflow semantics and marker/export/session behavior in `scripts/pi-editor-lib/workflow.mjs` and related context modules.
- Config resolution precedence contract (`resolveConfig` behavior).
- nvr fallback/retry contract fields already covered by existing tests.

## SCOPE LIMITS
- No new dependencies.
- No large architecture rewrite outside listed files.
- No change to default mode (`context`).
- No attempt to unify nvr/nvim diff wait semantics in this plan (preserve current behavior).
- `--no-wait` is in scope only for plain mode in this plan.
- No broader extension UX redesign beyond command invocation changes needed for explicit diff mode.
</boundaries>

<verification>
Run in repo root:
1. `node tests/pi-editor/run.mjs`
2. `npm test`
3. Optional sanity checks:
   - `node scripts/pi-editor.mjs --mode diff old new` (with stubs/mocks in tests rather than real editor spawn in CI)
   - `node scripts/pi-editor.mjs` (expect usage + exit 2)

Validation focus:
- New diff mode behavior is explicit and strict.
- Plain `--no-wait` behavior is explicit, plain-only, and covered by tests.
- Plain/context behavior still passes prior contracts.
- Files extension diff path uses explicit diff mode for pi-editor.
- Files extension reveal path uses plain `--no-wait` when pi-editor is selected.
</verification>

<success_criteria>
- All ACs met and test suite green.
- No regressions in existing context/plain contract tests.
- `--mode diff` is fully represented in CLI parsing, routing, and tests.
- Code is less ambiguous: diff intent no longer depends on caller using plain-mode conventions.
</success_criteria>

<output>
Produce `SUMMARY.md` including:
- AC-by-AC status (`AC-1`, `AC-2`, `AC-2b`, `AC-3`, `AC-4`, `AC-5`),
- exact files changed,
- concise summary of parser/routing changes,
- test changes (added/updated/removed),
- verification command outputs,
- any residual risks or follow-up recommendations.
</output>
