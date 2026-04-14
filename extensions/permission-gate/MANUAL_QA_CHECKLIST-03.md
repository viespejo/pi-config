# permission-gate – Manual QA Checklist (Plan 03 Bash Hardening)

Date: ____________________
Tester: __________________
Environment:
- OS: ____________________
- Shell/TUI: _____________
- Extension build/commit: ____________________

---

## Preconditions

- [ ] `permission-gate` extension is enabled.
- [ ] Interactive UI is available (for approval prompts and notifications).
- [ ] Disposable test workspace prepared.
- [ ] `~/.pi/settings.json` and `<cwd>/.pi/settings.json` can be edited for test scenarios.
- [ ] Ability to run slash command `/pgate`.

---

## AC-1: Hard-deny is always enforced

Steps:
1. Trigger a bash tool call with a hard-deny command (example: `rm -rf /`).
2. Observe behavior.

Expected:
- Immediate block.
- No approval path shown.

Result:
- [ ] PASS
- [ ] FAIL

Evidence/notes:
- ____________________________________________

---

## AC-2: Config resolution and precedence are deterministic

Steps:
1. Set `permissionGate.permissions` in `~/.pi/settings.json` (global).
2. Set a different `permissionGate.permissions` in `<cwd>/.pi/settings.json` (local).
3. Trigger bash command matching global but not local (or vice versa).

Expected:
- Local `permissionGate.permissions` fully replaces global for this key.

Result:
- [ ] PASS
- [ ] FAIL

Evidence/notes:
- ____________________________________________

---

## AC-3: Rule evaluation order is correct (`deny > ask > allow > default`)

Steps:
1. Configure overlapping `deny`, `ask`, and `allow` Bash rules.
2. Run command matching all three.
3. Run command matching only `ask` and `allow`.
4. Run command matching only `allow`.

Expected:
- Priority is deterministic: `deny` first, then `ask`, then `allow`, then default.

Result:
- [ ] PASS
- [ ] FAIL

Evidence/notes:
- ____________________________________________

---

## AC-4: High-risk always requires double confirmation

Steps:
1. Trigger a high-risk bash command (example: `sudo echo hi`).
2. Choose `Run high-risk once`.
3. Complete typed confirmation with `RUN` (or `run`).
4. Repeat and type invalid confirmation.

Expected:
- Two-step flow always required for high-risk.
- Only `RUN` / `run` accepted.
- Invalid typed confirmation blocks command.

Result:
- [ ] PASS
- [ ] FAIL

Evidence/notes:
- ____________________________________________

---

## AC-5: Ask rules do not force double confirmation by themselves

Steps:
1. Configure an `ask` rule for non-high-risk command.
2. Trigger matching command.

Expected:
- Simple one-step prompt (`Run once` / `Block`).
- No typed `RUN` step.

Result:
- [ ] PASS
- [ ] FAIL

Evidence/notes:
- ____________________________________________

---

## AC-6: Allow rules do not bypass high-risk protection

Steps:
1. Configure `allow` rule matching a high-risk command.
2. Trigger the command.

Expected:
- Still requires high-risk two-step confirmation.

Result:
- [ ] PASS
- [ ] FAIL

Evidence/notes:
- ____________________________________________

---

## AC-7: Command segmentation works for composed bash inputs

Steps:
1. Configure a rule targeting one segment (example deny `Bash(git push *)`).
2. Run composed command (example `echo ok && git push origin main`).
3. Repeat with `ask` and `allow` segmentation scenarios.

Expected:
- Matching is evaluated per segment.
- `deny/ask`: any matching segment applies.
- `allow`: matching segment can apply, high-risk still enforced.

Result:
- [ ] PASS
- [ ] FAIL

Evidence/notes:
- ____________________________________________

---

## AC-8: `/pgate` command is operational

### `/pgate status`
- [ ] PASS
- [ ] FAIL

### `/pgate test Bash(...)`
- [ ] PASS
- [ ] FAIL

### `/pgate reload`
- [ ] PASS
- [ ] FAIL

### `/pgate clear-session`
- [ ] PASS
- [ ] FAIL

Expected:
- Clear and coherent feedback for each subcommand.

Evidence/notes:
- ____________________________________________

---

## AC-9: Existing non-bash behavior remains stable

Regression checks:
- [ ] `edit` flow still supports `View diff` and `Review in Neovim`.
- [ ] `write` flow still supports `View diff` and `Review in Neovim`.
- [ ] Non-bash `Yes, always this session` still works.
- [ ] Read-only tools remain auto-allowed.

Result:
- [ ] PASS
- [ ] FAIL

Evidence/notes:
- ____________________________________________

---

## Final QA verdict

- [ ] All AC-1..AC-9 passed
- [ ] Regressions detected (document below)

Summary:
- ____________________________________________
- ____________________________________________
