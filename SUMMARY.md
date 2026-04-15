1. **Operational Changes Applied**
   - `~/.config/nvim/lua/plugins/sidekick.lua` (external to repo): documented PI-only env scope, tmux stale-env caveat, manual refresh strategy, and kept command identity explicit as `cmd = { "pi" }`.
   - `scripts/pi-editor-context.mjs`: added operational debug observability for config precedence, session discovery trace, branch leaf selection, context extraction/truncation stats, editor mode decision, and prompt export char/byte summaries.
   - `scripts/pi-editor-context`: added concise operator-facing debug usage notes (`PI_EDITOR_DEBUG=1`, debug log location).
   - `docs/pi-editor-context-technical-spec.md`: added an operational hardening section with stale-env symptoms, deterministic recovery runbook, smoke commands, expected debug signals, and a compact low-context checklist.

2. **Smoke Scenarios Executed**
   - Scenario: Deterministic wrapper diagnostics capture (non-interactive).
     - Command sequence:
       - `node tests/pi-editor-context/run.mjs`
       - one-shot debug invocation via Node harness calling `runEditorContext(...)` with `PI_EDITOR_DEBUG=1` and fixture session file.
       - `tail -n 20 ~/.local/state/pi-editor/debug.log`
     - Observed behavior:
       - Test harness result: `Summary: 6 passed, 0 failed, 6 total`.
       - Debug log emitted required signals: `config-resolved`, `session-discovery`, `branch-selection`, `context-built`, `editor-open`, `exported`.
       - `exported` included char/byte summary fields (`outputChars`, `outputBytes`, `inputPromptChars`, `inputPromptBytes`, `contextChars`, `contextBytes`).

   - Scenario: Lint/format gate for modified artifacts.
     - Command sequence:
       - `npx prettier --write scripts/pi-editor-context.mjs`
       - `npx prettier --check scripts/pi-editor-context.mjs`
       - `npm run lint`
     - Observed behavior:
       - Prettier check passed for modified JS module.
       - ESLint reported 0 errors; warnings are pre-existing in unrelated `tallow-extensions/*` files.

3. **Acceptance Criteria Results**
   - **AC-1: Environment drift detectability** — **PASS**
     - Evidence: `config-resolved` records effective config + source-by-field precedence; `editor-open` records requested/effective mode; `session-discovery` records selected source/path.
   - **AC-2: Recovery runbook availability** — **PASS**
     - Evidence: technical spec now contains deterministic tmux recovery steps (`<leader>sd` -> `<leader>ss`) and post-recovery verification instructions.
   - **AC-3: Non-breaking Sidekick integration** — **PASS**
     - Evidence: PI identity preserved as `cmd = { "pi" }`; PI-scoped env remains under `cli.tools.pi.env`; no non-PI tool changes were introduced.
   - **AC-4: Wrapper operational observability** — **PASS**
     - Evidence: debug log now includes precedence result, session path/source details, selected leaf id, context message/truncation stats, editor open decision, and export length summary (chars/bytes).
   - **AC-5: Safe default behavior preserved** — **PASS**
     - Evidence: debug path is opt-in (`PI_EDITOR_DEBUG=1`); debug write failures are swallowed by design; soft error policy behavior remains unchanged and covered by existing tests.

4. **Runbook Validation**
   - Confirmed recovery workflow is documented and executable:
     1. Reproduce once with debug enabled.
     2. Inspect `~/.local/state/pi-editor/debug.log` for mismatch.
     3. Close Sidekick PI session (`<leader>sd`).
     4. Re-select PI (`<leader>ss`).
     5. Re-run external editor and verify corrected `config-resolved` + `editor-open` signals.
   - Validation status: documented and traceable through debug evidence; interactive tmux pane cycling is operator-driven and consistent with Sidekick workflow constraints.

5. **Residual Risks**
   - Existing tmux sessions can still carry stale env until explicitly recycled; this is expected behavior and now documented.
   - `scripts/pi-editor-context` shell launcher is not covered by current Prettier parser setup; formatting remains manually maintained.
   - Repository has unrelated pre-existing ESLint warnings in `tallow-extensions/*`; they do not block this plan phase.

6. **Latest Runtime Deltas (Session Handoff Addendum)**
   - `scripts/pi-editor-context.mjs` now resolves `nvr` target server dynamically and deterministically:
     - candidate precedence: process env `PI_EDITOR_NVR_SERVER` -> tmux global `PI_EDITOR_NVR_SERVER` -> `NVIM` -> `NVIM_LISTEN_ADDRESS`
     - candidates are validated against `nvr --serverlist`
     - `nvr` invocation is pinned to `--servername <resolved>` + `--nostart`
   - `nvr` launch behavior is simplified and fixed:
     - always opens in split (`-cc split`)
     - always waits with `--remote-wait-silent`
     - tab wait-mode support was removed from config and docs
   - Editor-open UX was refined:
     - opening view is initialized to prompt section (`PI_PROMPT_START` anchor)
     - cursor is moved to end-of-prompt for immediate input
     - context block includes an operator note that context is not exported and markers must not be altered

7. **Quick Manual Validation for Next Session**
   - Trigger `Ctrl+G` in Sidekick PI flow and confirm:
     1. editor opens in split (terminal pane preserved)
     2. no `nvr` startup noise/flicker leading to detached local instance
     3. prompt region is focused on open; cursor is at end
     4. `:q`/`:wq` returns control without terminal deadlock
   - Optional debug confirmation (`PI_EDITOR_DEBUG=1`):
     - inspect `editor-returned.editorDecision` for `effectiveMode`, `nvrTargetServer`, `nvrServerSource`, `candidateServers`, `availableServers`

8. **Reference Commits (Chronological)**
   - `be7d25a` — stabilize nvr auto-targeting and split-based editor open
   - `1b0e347` — remove nvr tab mode and enforce split remote-wait flow
   - `f4f0530` — refine editor open positioning and add marker safety note
