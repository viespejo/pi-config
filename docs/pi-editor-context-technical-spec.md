# PI External Editor Context Injection — Technical Specification

## 1. Objective

Provide deterministic, low-friction context injection for PI external editing (`Ctrl+G`) so GitHub Copilot can suggest better completions based on recent PI conversation history, while ensuring that only the user-authored prompt body is sent back to PI.

## 2. Scope

### In Scope

- External editor wrapper flow used by PI via `$EDITOR` / `$VISUAL`.
- Session discovery from PI JSONL sessions.
- Branch-accurate history extraction using `id`/`parentId` graph reconstruction.
- Context injection into a working file with explicit markers.
- Prompt extraction back into PI temp file (context excluded).
- Sidekick integration through `cli.tools.pi.env`.
- Optional configuration layering: env > project config > user config > defaults.

### Out of Scope

- Modifying PI internals.
- Changing Copilot behavior itself.
- Activating or modifying inactive local extensions.
- Implementing Neovim diff-review workflows.

## 3. Design Decisions (Locked)

1. Injected context is local-only and never sent to PI.
2. Session source strategy: auto-detect by cwd, with explicit session override.
3. Branch strategy: precise branch reconstruction (not append-only tail).
4. Included content: only `user` and visible `assistant` text blocks.
5. Default message window: 12 messages; configurable.
6. Context and prompt delimiters:
   - `<!-- PI_CONTEXT_START -->`
   - `<!-- PI_CONTEXT_END -->`
   - `<!-- PI_PROMPT_START -->`
7. Context remains editable but is ignored on export.
8. Session auto-detection: cwd bucket first, global mtime fallback.
9. Parser strategy: Node-first implementation; optional helper behavior allowed.
10. Failure strategy: fail-open by default.
11. Prompt body extraction preserves leading whitespace and trims only one trailing newline.
12. Content language in generated artifacts: English.

## 4. Runtime Architecture

### 4.1 Entry Points

- `scripts/pi-editor-context.mjs` (main orchestrator)
- `scripts/pi-editor-context` (launcher wrapper)
- Optional user-level shim:
  - `~/.local/bin/pi-editor-context` -> calls repo wrapper or Node script

### 4.2 Execution Flow

1. PI invokes editor wrapper with temp file path.
2. Wrapper resolves effective configuration.
3. Wrapper reads original PI temp content (`promptBase`).
4. Wrapper discovers candidate session file.
5. Wrapper parses JSONL and reconstructs current leaf branch.
6. Wrapper extracts last N user/assistant messages under character limits.
7. Wrapper writes a working file:
   - optional help header
   - context block
   - prompt marker
   - base prompt body
8. Wrapper opens Neovim according to open mode:
   - nvr/nvim, buffer/tab policy configurable
9. On editor close, wrapper extracts prompt region and writes to original PI temp file.
10. Cleanup temp artifacts according to selected working mode.

## 5. Session Discovery and Branch Reconstruction

### 5.1 Session Directory Resolution Order

1. `PI_EDITOR_SESSIONS_DIR`
2. `${PI_CODING_AGENT_DIR}/sessions`
3. `~/.pi/agent/sessions`

### 5.2 CWD Resolution Order

1. `PI_EDITOR_CWD_HINT`
2. `PWD`
3. `process.cwd()`

### 5.3 Candidate Buckets

- Encoded bucket for raw cwd
- Encoded bucket for realpath(cwd)
- Fallback to global newest `*.jsonl` under sessions root

### 5.4 Branch-Accurate Leaf Selection

- Parse all entries with `id`.
- Build `parentId` reference set.
- Compute leaves = entries whose `id` is not in reference set.
- Select most recent leaf by timestamp, fallback by file order.
- Traverse ancestors via `parentId` to root.

### 5.5 Extracted Message Rules

- Include only entries of `type: "message"` with:
  - `message.role == "user"`
  - `message.role == "assistant"` with visible `text` blocks only
- Exclude `thinking`, `toolCall`, `toolResult`, `compaction`, `branch_summary`, custom entries.

## 6. Context Formatting

Format:

- `U: ...`
- `A: ...`
- Multiline continuation lines indented by three spaces.

Ordering:

- Chronological (oldest to newest) within selected window.

Sanitization:

- Strip ANSI/control characters.

## 7. Prompt Markers and Export Contract

Working file contract:

```md
<!-- PI_CONTEXT_START -->

...context lines...

<!-- PI_CONTEXT_END -->

<!-- PI_PROMPT_START -->

...editable prompt body...
```

Export contract:

- Only content after `PI_PROMPT_START` is written back to PI temp file.
- Context block is always excluded.

## 8. Configuration Model

Precedence:

1. Environment variables
2. Project config: `.pi/editor-context.json`
3. User config: `~/.config/pi-editor-context/config.json`
4. Internal defaults

### 8.1 Core Variables

- `PI_EDITOR_CONTEXT_ENABLED` (`1`/`0`, default `1`)
- `PI_EDITOR_CONTEXT_MESSAGES` (default `12`)
- `PI_EDITOR_CONTEXT_SESSION_FILE` (optional)
- `PI_EDITOR_CONTEXT_INCLUDE_ASSISTANT` (default `1`)
- `PI_EDITOR_CONTEXT_MAX_CHARS` (default `12000`)
- `PI_EDITOR_CONTEXT_MAX_PER_MESSAGE` (default `2000`)
- `PI_EDITOR_CONTEXT_MAX_AGE_DAYS` (optional)
- `PI_EDITOR_CONTEXT_SHOW_TIME` (`1`/`0`, default `0`)

### 8.2 Editor Launch Variables

- `PI_EDITOR_OPEN_MODE` (`auto|nvr|nvim`, default `auto`)
- `PI_EDITOR_NVR_WAIT_MODE` (`buffer|tab`, default `buffer`)
- `PI_EDITOR_WORKING_MODE` (`temp|persistent`, default `temp`)
- `PI_EDITOR_EMPTY_POLICY` (`allow|restore`, default `allow`)
- `PI_EDITOR_ERROR_POLICY` (`soft|hard`, default `soft`)

### 8.3 Path Variables

- `PI_EDITOR_SESSIONS_DIR`
- `PI_CODING_AGENT_DIR`
- `PI_EDITOR_CWD_HINT`

### 8.4 Debug

- `PI_EDITOR_DEBUG` (`1`/`0`)
- Debug log path: `~/.local/state/pi-editor/debug.log`

## 9. Sidekick Integration

Target file:

- `~/.config/nvim/lua/plugins/sidekick.lua`

Strategy:

- Keep `pi` command identity.
- Inject env vars in `cli.tools.pi.env`:
  - `EDITOR`
  - `VISUAL`
- Keep `mux.enabled = true`; if env drift occurs, detach and reopen session manually.

## 10. Error Handling

Default behavior (`soft`):

- Never break PI external editor flow.
- If session parse/discovery fails, open editor with prompt base only.
- Preserve original temp file when recoverable.

`hard` mode:

- Return non-zero on critical failures.

## 11. Security and Privacy

- No redaction by default.
- Context derived from local session files only.
- No network operations.

## 12. Test Matrix

1. No session file found -> normal editing still works.
2. Session found with branch history -> extracted context matches selected leaf path.
3. Oversized messages -> per-message and global truncation applied.
4. Prompt extraction -> context never returned to PI.
5. Empty prompt behavior -> policy respected (`allow` / `restore`).
6. `nvr` buffer and tab wait modes -> close returns control correctly.
7. Sidekick launch with env injection -> PI uses wrapper.
8. Config precedence -> env overrides project/user/defaults.

## 13. Deliverables

- Main script implementing full flow.
- Launcher wrapper script.
- Neovim Sidekick config update snippet.
- PLAN.md executable implementation plan.

## 14. Operational Hardening (Sidekick + tmux Reuse)

This section defines day-2 recovery behavior when Sidekick reuses tmux sessions and PI starts with stale editor environment values.

### 14.1 Typical Stale-Env Symptoms

- `Ctrl+G` opens an unexpected editor mode (e.g., old binary path or wrong wait behavior).
- Wrapper debug entries do not reflect current `cli.tools.pi.env` values.
- `EDITOR`/`VISUAL` changes in Sidekick config do not apply to an already running PI tmux pane.

### 14.2 Why It Happens

With `cli.mux.enabled = true` and `backend = "tmux"`, an existing PI process may persist across Sidekick toggles. The process can keep environment values captured at process start, even after Neovim config updates.

### 14.3 Recovery Runbook (Deterministic)

1. Enable diagnostics for the next run:
   - set `PI_EDITOR_DEBUG=1` in PI-scoped env (Sidekick PI tool env or one-shot shell).
2. Trigger PI external editor once (`Ctrl+G`) and inspect:
   - `~/.local/state/pi-editor/debug.log`
3. If mismatch is confirmed, recycle the Sidekick PI session:
   - close current session: `<leader>sd`
   - re-select PI tool: `<leader>ss`
4. Trigger external editor again.
5. Confirm corrected runtime signals in debug log (`config-resolved`, `editor-open`, `exported`).

This recovery is local and does not require global shell profile changes.

### 14.4 Recommended Smoke Commands

```bash
# 1) Run wrapper diagnostics in a one-shot PI invocation
PI_EDITOR_DEBUG=1 EDITOR=/absolute/path/to/scripts/pi-editor-context VISUAL=/absolute/path/to/scripts/pi-editor-context pi

# 2) Inspect latest debug signals
tail -n 50 ~/.local/state/pi-editor/debug.log

# 3) Optional focused checks
rg "config-resolved|session-discovery|branch-selection|context-built|editor-open|exported" ~/.local/state/pi-editor/debug.log
```

### 14.5 Expected Debug Signals

When `PI_EDITOR_DEBUG=1`, each wrapper execution should emit human-readable JSON payloads for:

- `config-resolved`
  - includes effective config and source precedence per field (`env|project|user|default`)
- `session-discovery`
  - includes candidates and selected session source/path
- `branch-selection`
  - includes selected leaf id and leaf count
- `context-built`
  - includes context message counts and truncation stats
- `editor-open`
  - includes requested/effective mode and wait behavior
- `exported`
  - includes input/output/context char+byte summary

Debug logging failures must not interrupt default editing flow.

### 14.6 Low-Context Agent Checklist

- [ ] Confirm PI command identity remains `cmd = { "pi" }`.
- [ ] Confirm PI-only env scope is under `cli.tools.pi.env`.
- [ ] Reproduce issue once with `PI_EDITOR_DEBUG=1`.
- [ ] Verify mismatch via `debug.log` (do not inspect Sidekick internals first).
- [ ] Apply tmux recovery (`<leader>sd` then `<leader>ss`).
- [ ] Re-test `Ctrl+G` and validate corrected debug signals.
- [ ] Keep default non-debug flow unchanged.
