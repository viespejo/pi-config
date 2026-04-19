# permission-gate extension

A conservative approval layer for Pi tool calls, with hardened `bash` safety.

## What this phase adds

This phase hardens `bash` execution without changing existing `edit` / `write` workflows.

Implemented behavior:

- Non-overridable **hard-deny** checks for catastrophic shell commands.
- Config-driven `bash` policy from settings (`deny > ask > allow > default`).
- **High-risk** detection with mandatory two-step confirmation (`RUN` / `run`).
- `/pgate` operational command for status, testing, reload, and session reset.

Preserved behavior:

- `edit` / `write` approval loop and Neovim review flow remain unchanged.
- Read-only tools (`read`, `ls`, `grep`, `find`) stay auto-allowed.
- `bash` still has no "always this session" mode.

---

## Bash decision order

For `bash` tool calls, the extension evaluates in this order:

1. **Hard-deny** (immediate block, no approval path)
2. **Configured rules** from settings (`deny > ask > allow`)
3. **High-risk classifier**
4. **Default simple confirmation**

Important rule interaction:

- `allow` does **not** bypass high-risk protection.
- `ask` uses simple confirmation unless the command is also high-risk.

---

## Bash confirmation UX

### Simple confirmation

Used for default and `ask` (non-high-risk):

- `Run once`
- `Explain command`
- `Block`

### Explain command

`Explain command` requests a concise English explanation before deciding.

Rendered fields:

- `Summary`
- `Risks`
- `Impact`
- `Recommendation` (`safe-ish | caution | dangerous`)
- `Flags` (only when useful)

Behavior notes:

- The explanation is shown inline in the same prompt and the same decision menu is shown again.
- If explanation generation fails (model/auth/timeout/invalid output), a warning is shown and the run/block flow remains usable.
- Explanations are advisory only and do not replace user judgment or policy enforcement.

Short example (simple flow):

1. User sees options: `Run once`, `Explain command`, `Block`.
2. User selects `Explain command`.
3. Prompt updates with `Explanation (AI)` and the same options are shown again.
4. User chooses `Run once` or `Block`.

This same explain behavior also applies to the first high-risk menu.

### High-risk confirmation

Used whenever command is classified high-risk:

1. First choice:
   - `Run high-risk once`
   - `Explain command`
   - `Block`
2. Second required step (only after choosing `Run high-risk once`):
   - typed confirmation input must be exactly `RUN` or `run`

If any high-risk step fails, the command is blocked.

---

## High-risk signals

High-risk includes (non-exhaustive examples):

- `sudo`
- `curl ... | bash` / `wget ... | bash`
- `chmod -R 777`
- `chown -R root`
- `git reset --hard`
- `git clean -f...`
- `dd if=...`
- explicit path targets outside cwd (when path tokens are resolvable)
- script / runner execution patterns:
  - direct script calls or interpreter-driven script calls
  - `npm|pnpm|yarn|bun run`, `make`, `just`

Hard-deny includes catastrophic patterns (e.g. destructive root deletion) and blocks immediately.

---

## Config contract

Settings are loaded from:

- Global: `~/.pi/agent/settings.json`
- Local: `<cwd>/.pi/settings.json`

Read key:

- `permissionGate.permissions`

Example schema:

```json
{
  "permissionGate": {
    "permissions": {
      "allow": ["Bash(echo *)"],
      "ask": ["Bash(git push *)"],
      "deny": ["Bash(rm -rf *)"]
    }
  }
}
```

### Precedence between files

If local `<cwd>/.pi/settings.json` defines `permissionGate.permissions`, it **fully replaces** global permissions for this key.

### Rule syntax

- `Tool(specifier)`
- wildcard support via `*`
- runtime decisioning in this phase evaluates only `Bash(...)` rules

### Segmentation for composed bash commands

For commands like:

```bash
echo ok && git push origin main
```

matching is performed per shell segment (`&&`, `||`, `;`, `|`, newline boundaries):

- `deny` / `ask`: any matching segment applies
- `allow`: matching segment can allow candidate, but high-risk checks still apply

---

## `/pgate` command

Available subcommands:

- `/pgate status`
  - shows active settings source, rule counts, warnings
- `/pgate test Bash(<command>)`
  - evaluates config + risk classification and reports result
- `/pgate reload`
  - reloads permission-rule cache only
- `/pgate clear-session`
  - clears in-memory non-bash session allow-list

`/pgate reload` does **not** clear session allow-list.

---

## Non-bash behavior (unchanged)

- `read`, `ls`, `grep`, `find`: auto-allowed
- most tools: `Yes`, `Yes, always this session`, `No`
- `edit` / `write`: keep diff + Neovim review loop unchanged
- when UI is unavailable for required confirmation paths, calls are blocked conservatively

---

## Test

```bash
cd extensions/permission-gate
npm test
```
