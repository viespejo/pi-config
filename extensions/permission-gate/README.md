# permission-gate extension

A conservative approval layer for Pi tool calls.

It prompts before potentially dangerous tool executions, supports diff previews for file mutations, and keeps a small in-memory allow-list for the current session.

## TL;DR (30 seconds)

- Read-only tools (`read`, `ls`, `grep`, `find`) are auto-allowed.
- Other tools require explicit approval in the UI.
- `edit` and `write` support **View diff** before approving.
- If UI is unavailable, calls are blocked conservatively.
- `Yes, always this session` works for non-`bash` tools.

Quick test run:

```bash
cd extensions/permission-gate
npm test
```

---

## What this extension does

On each `tool_call`, the extension applies this policy:

1. **Always allow** read-only tools:
   - `read`
   - `ls`
   - `grep`
   - `find`
2. For other tools, ask the user for approval in the UI.
3. If there is **no UI available**, block the call conservatively.

For `edit` and `write`, the prompt includes a **View diff** option.

---

## Approval behavior

### Default choices

- For most tools: `Yes`, `Yes, always this session`, `No`
- For `bash`: `Yes`, `No` (no session persistence)
- For `edit` / `write`: `Yes`, `View diff`, `Yes, always this session`, `No`

### Session allow-list

If the user chooses **"Yes, always this session"** for a non-`bash` tool, that tool is remembered and future calls of the same tool are auto-allowed for this agent session.

### Denials

If denied, the extension optionally asks for a reason and returns:

- `Blocked by user`
- or `Blocked by user. Reason: <text>`

---

## Diff preview behavior

### `write`

- Computes a local preview diff between existing file content and incoming content.
- Supports both overwrite and new-file creation previews.
- If content is unchanged, reports an explicit no-op style message.
- If diff rendering fails unexpectedly, falls back to a safe "preview unavailable" prompt.

### `edit`

- Tries to load Pi's internal edit-diff utility once and cache it.
- If not available, falls back to a local exact-match edit diff implementation.
- The user is informed via a one-time warning notification during session warmup when fallback is used.

---

## Events used

- `session_start`
  - Warm up internal edit-diff loader once.
  - Optionally show a warning notification if local edit fallback is active.
- `tool_call`
  - Apply approval policy and return block decisions when needed.

---

## File map

- `src/index.ts` — main orchestration and event handlers
- `src/gate-policy.ts` — allow rules and option presets
- `src/tool-input.ts` — robust extraction of tool input payloads
- `src/write-preview.ts` — write preview diff + metadata summary
- `src/edit-diff-loader.ts` — one-time internal edit-diff loader
- `src/edit-diff.ts` — local edit diff fallback
- `src/edit-preview.ts` — edit metadata summary for fallback prompts
- `src/diff-viewer.ts` — custom UI rendering for diff dialogs
- `src/prompt-messages.ts` — centralized prompt/message constants

---

## Testing

Run tests from this extension directory:

```bash
cd extensions/permission-gate
npm test
```

Current suite covers policy logic, input parsing, prompt templates, edit/write preview flows, loader caching, fallback behavior, and end-to-end `tool_call` behavior.

See `TEST_PLAN.md` for the coverage matrix.

---

## Notes and constraints

- The extension is intentionally conservative: if UI is unavailable or prompt interaction fails, it blocks.
- Session allow-list is in-memory only (per running agent process).
- Package is configured as ESM (`"type": "module"`).
