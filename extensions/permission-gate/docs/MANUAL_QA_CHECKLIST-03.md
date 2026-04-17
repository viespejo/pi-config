# permission-gate – Manual QA Checklist (Plan 03 Bash Hardening)

Date: 2026-04-14
Tester: Vicente Espejo
Environment:
- OS: Arch Linux
- Shell/TUI: kitty + zsh
- Neovim: NVIM v0.11.2
- Extension build/commit: N/A (not provided)

---

## Preconditions

- [x] `permission-gate` extension is enabled.
- [x] Interactive UI is available (for approval prompts and notifications).
- [x] Disposable test workspace prepared.
- [x] `~/.pi/settings.json` and `<cwd>/.pi/settings.json` can be edited for test scenarios.
- [x] Ability to run slash command `/pgate`.

---

## AC-1: Hard-deny is always enforced

Steps:
1. Trigger a bash tool call with a hard-deny command (example: `rm -rf /`).
2. Observe behavior.

Expected:
- Immediate block.
- No approval path shown.

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Executed `mkfs.notreal /tmp/pgate-qa`.
- Immediate block with message: `Blocked: hard-deny policy. Detected filesystem formatting command (mkfs).`
- No approval prompt/approval path shown.

---

## AC-2: Config resolution and precedence are deterministic

Steps:
1. Set `permissionGate.permissions` in `~/.pi/settings.json` (global).
2. Set a different `permissionGate.permissions` in `<cwd>/.pi/settings.json` (local).
3. Trigger bash command matching global but not local (or vice versa).

Expected:
- Local `permissionGate.permissions` fully replaces global for this key.

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- `/pgate reload` => `permission-gate reloaded: source=local, rules=1,warnings=0`
- `/pgate test Bash(echo global-allow-1)` => `action=default, rule=none, highRisk=no`
- `/pgate test Bash(echo local-ask-1)` => `action=ask, rule=Bash(echo local-ask*), highRisk=no`
- `/pgate status` => `source=local, rules=1 (allow=0, ask=1, deny=0), warnings=0`

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
- [x] PASS
- [ ] FAIL

Evidence/notes:
- `Bash(git push origin main)` evaluated as `deny` (deny wins over ask/allow).
- `Bash(echo ask-and-allow-1)` evaluated as `ask` (ask wins over allow).
- `Bash(echo allow-only-1)` evaluated as `allow`.
- `Bash(echo no-match-1)` evaluated as `default`.

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
- [x] PASS
- [ ] FAIL

Evidence/notes:
- High-risk command showed two-step confirmation flow.
- `RUN`/`run` allowed execution path.
- Invalid typed confirmation blocked with high-risk confirmation failure.
- When allowed, `sudo` then requested password and failed due to credentials (expected post-gate behavior; does not affect AC).

---

## AC-5: Ask rules do not force double confirmation by themselves

Steps:
1. Configure an `ask` rule for non-high-risk command.
2. Trigger matching command.

Expected:
- Simple one-step prompt (`Run once` / `Block`).
- No typed `RUN` step.

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Matching non-high-risk `ask` command produced only simple one-step prompt (`Run once` / `Block`).
- No typed confirmation step requested.

---

## AC-6: Allow rules do not bypass high-risk protection

Steps:
1. Configure `allow` rule matching a high-risk command.
2. Trigger the command.

Expected:
- Still requires high-risk two-step confirmation.

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- With `allow` rule matching `sudo *`, command still required high-risk two-step flow.
- `allow` did not bypass typed `RUN`/`run` confirmation.

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
- [x] PASS
- [ ] FAIL

Evidence/notes:
- `echo ok && git push origin main` => `deny` (deny segment matched).
- `echo ok && git status` => `ask` (ask segment matched).
- `echo seg-allow-1 && echo done` => `allow` (allow segment matched).
- High-risk segment scenario reported highRisk accordingly and preserves high-risk enforcement behavior.

---

## AC-8: `/pgate` command is operational

### `/pgate status`
- [x] PASS
- [ ] FAIL

### `/pgate test Bash(...)`
- [x] PASS
- [ ] FAIL

### `/pgate reload`
- [x] PASS
- [ ] FAIL

### `/pgate clear-session`
- [x] PASS
- [ ] FAIL

Expected:
- Clear and coherent feedback for each subcommand.

Evidence/notes:
- All `/pgate` subcommands returned coherent operational output: status summary, test action/rule/highRisk details, reload confirmation, and clear-session confirmation.

---

## AC-9: Existing non-bash behavior remains stable

Regression checks:
- [x] `edit` flow still supports `View diff` and `Review in Neovim`.
- [x] `write` flow still supports `View diff` and `Review in Neovim`.
- [x] Non-bash `Yes, always this session` still works.
- [x] Read-only tools remain auto-allowed.

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Regression checks completed; no behavior changes detected outside bash hardening scope.

---

## Final QA verdict

- [x] All AC-1..AC-9 passed
- [ ] Regressions detected (document below)

Summary:
- Manual QA completed for Plan 03 bash hardening; all acceptance criteria passed.
- No regressions observed in existing non-bash approval/diff/review flows.
