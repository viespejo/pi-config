# Execution Summary: 02-pi-editor-modes-01-diff-mode-clarity

## Acceptance Criteria Status

- **AC-1: Explicit mode routing contract is clear** ✅
  - `scripts/pi-editor.mjs` supports explicit `context | plain | diff` routing.
  - Default invocation (`pi-editor.mjs <pi-temp-file>`) remains `context`.
  - `diff` routes to dedicated runtime entrypoint (`runDiffEditor`).

- **AC-2: Diff mode parser is strict and deterministic** ✅
  - Strict parser rules implemented for:
    - `--mode diff <old> <new>`
    - `--mode diff <old> <new> -- <extraArgs...>`
    - `--mode diff <old> <new> --` (empty extras)
  - Malformed forms return usage semantics (exit code `2` in CLI path).

- **AC-2b: Plain no-wait runtime option is explicit and constrained** ✅
  - `--no-wait` accepted only in `--mode plain`.
  - CLI consumes `--no-wait` (not forwarded as editor arg).
  - Non-plain usage of `--no-wait` is rejected with usage / exit `2`.
  - Runtime no-wait affects only nvr-backed opens (`remote-silent`); nvim remains process-blocking.

- **AC-3: Diff behavior parity is preserved** ✅
  - Added `openDiffEditor(...)` and routed CLI diff mode through it.
  - Diff behavior still reuses existing diff argument/open logic and preserves prior UX semantics.
  - Existing nvr/nvim diff wait behavior remains unchanged (nvr diff => `remote-silent`).

- **AC-4: Files extension uses explicit diff mode and reveal no-wait** ✅
  - `extensions/files.ts` diff path for pi-editor uses explicit mode:
    - `pi-editor --mode diff <old> <new>`
    - with optional extras as `-- <extraArgs...>`
  - `extensions/files.ts` reveal path for pi-editor now uses:
    - `pi-editor --mode plain --no-wait ...`
  - Non-pi-editor branches (`vim -d`, `code --diff`, generic fallback) are preserved.

- **AC-5: Test suite documents new contract and removes stale implications** ✅
  - Added dedicated diff-mode and strict parser coverage.
  - Added plain `--no-wait` runtime and CLI invalid-usage coverage.
  - Updated stale plain passthrough expectations so plain no longer implies diff responsibility.

## Exact Files Changed

1. `scripts/pi-editor.mjs`
2. `scripts/pi-editor-lib/editor-open.mjs`
3. `extensions/files.ts`
4. `tests/pi-editor/cases.mjs`
5. `docs/plans/02-pi-editor-modes-01-diff-mode-clarity-summary.md`

## Parser and Routing Changes (Concise)

- Modes: `context|plain|diff` with default `context` (unchanged).
- Plain mode now supports `--no-wait` as plain-only runtime flag.
- `--no-wait` is consumed by CLI and propagated as runtime open option, not editor arg.
- Non-plain `--no-wait` usage now throws usage error (exit 2 in CLI path).
- Diff parsing remains strict and routes through dedicated diff runtime path.
- Usage text updated to include `--mode plain [--no-wait] <editor-args...>` and explicit diff syntax.

## Test Changes

### Added / Updated
- Added plain no-wait tests:
  - plain accepts `--no-wait`, consumes it, and does not forward it as editor arg
  - non-plain `--no-wait` is rejected at API-level parser contract
  - CLI invalid non-plain no-wait invocation returns usage + exit 2
- Added reveal-contract test ensuring files extension contains pi-editor reveal no-wait invocation.
- Kept and validated diff contract tests:
  - dedicated diff routing
  - valid forms (with/without `--`, including trailing `--`)
  - invalid forms usage error contract
- Kept plain/context existing contract tests and updated usage assertions.

### Removed / Replaced Implications
- Plain passthrough tests continue using neutral args (not `-d`), preventing plain-mode diff ambiguity.

## Verification Command Outputs

### 1) `node tests/pi-editor/run.mjs`
- **Result:** PASS
- **Summary:** `28 passed, 0 failed, 28 total`

### 2) `npm test`
- **Result:** PASS
- **Summary:** `28 passed, 0 failed, 28 total`

## Residual Risks / Follow-up Notes

- Reveal no-wait is intentionally scoped to pi-editor plain runtime and nvr semantics.
- Current reveal no-wait coverage includes source-level contract assertion in tests; if desired, a future extension-level behavioral harness could validate end-to-end spawn args with stronger runtime isolation.
