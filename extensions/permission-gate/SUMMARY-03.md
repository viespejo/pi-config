# Permission Gate – Bash Hardening Summary

## 1) Objective achieved

Implemented bash-hardening for `permission-gate` with deterministic rule loading/evaluation, non-overridable hard-deny behavior, high-risk two-step confirmation (`RUN`/`run`), and operational `/pgate` commands (`status`, `test`, `reload`, `clear-session`). Existing `edit`/`write` approval, diff preview, and Neovim review workflows remain unchanged.

## 2) Files changed

- `extensions/permission-gate/src/permission-rules.ts`
  - Added settings loading from global/local Pi settings, local-overrides-global replacement, bash-segment rule evaluation, cache/reload hooks.
- `extensions/permission-gate/src/index.ts`
  - Integrated hardened bash decision order, hard-deny/high-risk runtime orchestration, and `/pgate` command handlers.
- `extensions/permission-gate/src/gate-policy.ts`
  - Updated bash option sets (`Run once/Block`, high-risk variants) while preserving non-bash session behavior.
- `extensions/permission-gate/src/prompt-messages.ts`
  - Added bash-specific prompt copy and typed confirmation labels.
- `extensions/permission-gate/tests/tool-call.test.ts`
  - Added/updated end-to-end behavior tests for hard-deny, precedence, local override, segmentation, high-risk flow, and `/pgate` operations.
- `extensions/permission-gate/tests/gate-policy.test.ts`
  - Updated expected bash option wording and high-risk option variant coverage.
- `extensions/permission-gate/tests/prompt-messages.test.ts`
  - Added assertions for new bash prompt copy and typed-confirmation messaging.
- `extensions/permission-gate/README.md`
  - Documented settings contract, precedence, hard-deny/high-risk model, segmentation, and `/pgate` usage.
- `extensions/permission-gate/SUMMARY.md`
  - Replaced with final implementation + verification summary for this phase.

## 3) Behavior matrix

| Scenario | Outcome |
|---|---|
| Hard-deny match | Immediate block, no approval path |
| Config `deny` match | Block |
| Config `ask` match (non-high-risk) | Simple prompt: `Run once` / `Block` |
| Config `allow` match (non-high-risk) | Allow |
| Any high-risk command | Two-step confirmation required (`Run high-risk once` + typed `RUN`/`run`) |
| Config `allow` + high-risk | Still requires high-risk two-step confirmation |
| No rule match, non-high-risk | Simple prompt: `Run once` / `Block` |

## 4) Config contract

Settings sources:
- Global: `~/.pi/settings.json`
- Local: `<cwd>/.pi/settings.json`

Read key:
- `permissionGate.permissions`

Precedence:
- If local `permissionGate.permissions` exists, it **replaces** global for this key.

Rule shape:
- `Tool(specifier)` with wildcard `*`
- Runtime decisioning in this phase evaluates `Bash(...)` rules.

## 5) Verification evidence

Executed:
- `cd extensions/permission-gate && npm test -- --test-name-pattern "tool_call|gate-policy|prompt-messages"`
- `cd extensions/permission-gate && npm test`

Outcome:
- Pass (all tests green after updates).

## 6) Follow-ups (explicitly not implemented)

- Variable expansion in rules (`{cwd}`, `{home}`, `{project}`) is not implemented in this phase.
- Rule engine expansion to additional tool families beyond bash is not implemented in this phase.
