# PLAN-03 Real-World QA Checklist (Sidekick + PI Editor Context)

## 0) Preconditions

- [ ] Neovim config loaded with Sidekick PI tool config.
- [ ] PI tool identity is unchanged: `cmd = { "pi" }`.
- [ ] PI-scoped env is defined under `cli.tools.pi.env`:
  - [ ] `EDITOR=/.../scripts/pi-editor-context`
  - [ ] `VISUAL=/.../scripts/pi-editor-context`
- [ ] `cli.mux.enabled = true` and `backend = "tmux"`.
- [ ] Wrapper scripts are executable and available at configured paths.
- [ ] Debug log path is writable:
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

- [ ] External editor opens normally.
- [ ] Prompt edits are returned to PI.
- [ ] No visible flow regression.
- [ ] No hard failure in default mode.

---

## 2) Keymap/Integration Regression

### Steps

Run each mapping at least once:

- [ ] `<leader>so` (toggle)
- [ ] `<leader>ss` (select)
- [ ] `<leader>sd` (detach/close)
- [ ] send actions (`<leader>st`, `<leader>sf`, `<leader>sv`)

Then trigger `Ctrl+G` after re-selecting PI.

### Expected

- [ ] PI remains selectable/toggleable/send-capable.
- [ ] Session control still works with tmux backend.
- [ ] External editor integration remains functional.

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

- [ ] `config-resolved`
- [ ] `session-discovery`
- [ ] `branch-selection` (when session exists)
- [ ] `context-built`
- [ ] `editor-open`
- [ ] `exported`

### Expected payload coverage

- [ ] Config precedence/source-by-field (`env|project|user|default`)
- [ ] Selected session path/source
- [ ] Selected leaf id
- [ ] Context message count + truncation stats
- [ ] Requested/effective editor mode + wait behavior
- [ ] Export length summary (chars/bytes)

---

## 4) Stale-Env Drift Reproduction (tmux Reuse)

### Steps

1. Start PI session with current env.
2. Change PI-scoped env in config (e.g., `PI_EDITOR_OPEN_MODE` or wrapper path).
3. Reuse existing tmux PI session without closing it.
4. Trigger `Ctrl+G` and inspect debug log.

### Expected

- [ ] Drift/mismatch is diagnosable from debug signals.
- [ ] Operator can identify effective editor behavior from logs alone.

---

## 5) Recovery Runbook Validation

### Steps

1. Close existing PI session: `<leader>sd`.
2. Re-select PI: `<leader>ss`.
3. Trigger `Ctrl+G` again.
4. Re-check debug log.

### Expected

- [ ] Session relaunch picks up current PI-scoped env.
- [ ] `editor-open` and `config-resolved` reflect expected values.
- [ ] External editor behavior is corrected after reopen cycle.

---

## 6) Soft-Failure Safety (Operational)

### Steps

1. Keep default `PI_EDITOR_ERROR_POLICY=soft`.
2. Execute normal flow with debug both off and on.
3. Observe behavior on any incidental wrapper issue.

### Expected

- [ ] No hard stop in default soft mode.
- [ ] User can still edit prompt (fallback path if needed).
- [ ] Debug logging failures do not break editing flow.

---

## 7) Evidence Capture

For each scenario, record:

- [ ] Date/time
- [ ] Operator
- [ ] Command/key sequence
- [ ] Observed behavior
- [ ] Relevant debug log snippet
- [ ] Pass/Fail
- [ ] Follow-up action (if fail)

---

## 8) Exit Criteria

- [ ] All sections 1–5 pass.
- [ ] No blocker regressions in daily PI workflow.
- [ ] AC-1..AC-5 behavior is demonstrated in real-world operation.
