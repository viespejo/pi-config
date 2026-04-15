# PLAN-03 Real-World QA Checklist (Sidekick + PI Editor Context)

## 0) Preconditions

- [x] Neovim config loaded with Sidekick PI tool config.
- [x] PI tool identity is unchanged: `cmd = { "pi" }`.
- [x] PI-scoped env is defined under `cli.tools.pi.env`:
  - [x] `EDITOR=/.../scripts/pi-editor-context`
  - [x] `VISUAL=/.../scripts/pi-editor-context`
- [x] `cli.mux.enabled = true` and `backend = "tmux"`.
- [x] Wrapper scripts are executable and available at configured paths.
- [x] Debug log path is writable:
  - `~/.local/state/pi-editor/debug.log`

---

## 1) Baseline Workflow (No Debug)

### Steps

1. Open Neovim.
2. Select PI tool (`<leader>ss`).
3. Toggle Sidekick pane (`<leader>so`) if needed.
4. Send content (any send action).
5. Trigger external editor from PI (`Ctrl+G`).
6. Edit prompt and close editor.

### Expected

- [x] External editor opens normally.
- [x] Prompt edits are returned to PI.
- [x] No visible flow regression.
- [x] No hard failure in default mode.

---

## 2) Keymap/Integration Regression

### Steps

Run each mapping at least once:

- [x] `<leader>so` (toggle)
- [x] `<leader>ss` (select)
- [x] `<leader>sd` (detach/close)
- [x] send actions (`<leader>st`, `<leader>sf`, `<leader>sv`)

Then trigger `Ctrl+G` after re-selecting PI.

### Expected

- [x] PI remains selectable/toggleable/send-capable.
- [x] Session control still works with tmux backend.
- [x] External editor integration remains functional.

---

## 3) Debug Observability Signals (`PI_EDITOR_DEBUG=1`)

### Steps

1. Enable debug in PI-scoped env (`PI_EDITOR_DEBUG=1`).
2. Trigger external editor once.
3. Inspect log:

   ```bash
   tail -n 80 ~/.local/state/pi-editor/debug.log
   ```

### Expected required events

- [x] `config-resolved`
- [x] `session-discovery`
- [x] `branch-selection` (when session exists)
- [x] `context-built`
- [x] `editor-open`
- [x] `editor-returned`
- [x] `exported`

### Expected payload coverage

- [x] Config precedence/source-by-field (`env|project|user|default`)
- [x] Selected session path/source
- [x] Selected leaf id
- [x] Context message count + truncation stats
- [x] Requested editor mode is logged on `editor-open`; effective mode + wait behavior are logged on `editor-returned`
- [x] Export length summary (chars/bytes)

---

## 4) Stale-Env Drift Reproduction (tmux Reuse)

### Steps

1. Start PI session with current env.
2. Change PI-scoped env in config (e.g., `PI_EDITOR_OPEN_MODE` or wrapper path).
3. Reuse existing tmux PI session without closing it.
4. Trigger `Ctrl+G` and inspect debug log.

### Expected

- [x] Drift/mismatch is diagnosable from debug signals.
- [x] Operator can identify effective editor behavior from logs alone.

---

## 5) Recovery Runbook Validation

### Steps

1. Close existing PI process/session (note: `<leader>sd` may only detach in some setups).
2. Re-select PI: `<leader>ss`.
3. Trigger `Ctrl+G` again.
4. Re-check debug log.

### Expected

- [x] Session relaunch picks up current PI-scoped env.
- [x] `editor-open`, `editor-returned`, and `config-resolved` reflect expected values.
- [x] External editor behavior is corrected after reopen cycle.

---

## 6) Soft-Failure Safety (Operational)

### Steps

1. Keep default `PI_EDITOR_ERROR_POLICY=soft`.
2. Execute normal flow with debug both off and on.
3. Observe behavior on any incidental wrapper issue.

### Expected

- [x] No hard stop in default soft mode.
- [x] User can still edit prompt (fallback path if needed).
- [x] Debug logging failures do not break editing flow.

---

## 7) Evidence Capture

For each scenario, record:

- [x] Date/time
- [x] Operator
- [x] Command/key sequence
- [x] Observed behavior
- [x] Relevant debug log snippet
- [x] Pass/Fail
- [x] Follow-up action (if fail)

---

## 8) Exit Criteria

- [x] All sections 1–5 pass.
- [x] No blocker regressions in daily PI workflow.
- [x] AC-1..AC-5 behavior is demonstrated in real-world operation.
