# Permission Gate – Test Plan (pre-refactor baseline)

Goal: make the current test coverage explicit before starting refactors.

## How to run

```bash
cd extensions/permission-gate
npm test
```

---

## Current coverage matrix

| Functionality | Status | Test(s) |
|---|---:|---|
| Bypass for always-allowed tools (`read`, `ls`, `grep`, `find`) | ✅ | `tests/tool-call.test.ts` → `bypasses prompt for always-allow tools` |
| Conservative block when UI is unavailable | ✅ | `tests/tool-call.test.ts` → `blocks if no UI is available` |
| Deny flow with optional reason (`ui.input`) | ✅ | `tests/tool-call.test.ts` → `returns blocked reason from ui.input when user denies` |
| Deny flow still blocks if `ui.input` fails | ✅ | `tests/tool-call.test.ts` → `survives input failures and still blocks denied calls` |
| `Yes, always this session` for non-bash tools | ✅ | `tests/tool-call.test.ts` → `supports 'always this session' for non-bash tools` |
| Error handling when `ui.select` throws | ✅ | `tests/tool-call.test.ts` → `blocks when ui.select throws` |
| `write` flow with `View diff` option | ✅ | `tests/tool-call.test.ts` → `handles write diff preview flow for new files` |
| `edit` flow with `View diff` option | ✅ | `tests/tool-call.test.ts` → `handles edit diff preview flow` |
| `computeWriteDiffPreviewLocal`: new file case | ✅ | `tests/write-preview.test.ts` → `returns an all-added diff when target file does not exist` |
| `computeWriteDiffPreviewLocal`: overwrite case | ✅ | `tests/write-preview.test.ts` → `returns a regular diff for overwrite writes` |
| `computeWriteDiffPreviewLocal`: no-op case | ✅ | `tests/write-preview.test.ts` → `returns an explicit no-op error when content is unchanged` |

---

## Partial coverage / recommended next tests (before or during refactor)

1. **`session_start` warmup + fallback notify**
   - Verify warmup runs only once and notify remains best-effort.

2. **Session allow-list behavior for `bash`**
   - Explicitly verify `bash` is NOT added to `sessionAllow`.

3. **Metadata fallback for `edit`/`write`**
   - Cover invalid input cases (missing path/content/edits) and expected prompt text.

4. **Diff/render failure paths**
   - Ensure consistent behavior when diff computation or rendering fails.

5. **`showDiffInCustomDialog` (TUI navigation)**
   - If higher UI confidence is needed, add pure unit tests for offset/navigation logic (avoid fragile snapshots).

---

## Refactor guardrail

- Do not start major structural refactors without keeping `npm test` green.
- For each extracted module, move/add tests first (or in the same PR).
