# permission-gate – Manual QA Checklist (Neovim Review Plan)

Date: Tue Apr 14 12:07:52 AM CEST 2026
Tester: Vicente Espejo
Environment:
- OS: Arch Linux
- Shell: kitty + zsh
- Neovim version (`nvim --version`): NVIM v0.11.2
- Extension build/commit: N/A (not provided)

---

## Preconditions

- [x] `permission-gate` extension is enabled.
- [x] Test workspace is disposable.
- [x] A sample file exists (e.g., `sample.txt`).
- [x] Tool call UI prompts are visible.
- [x] (For AC-7) Ability to simulate missing `nvim` if needed.

---

## AC-1: Edit/write menu includes `Review in Neovim` in fixed order

### AC-1A (write)
Steps:
1. Trigger a `write` tool call.
2. Inspect approval options.

Expected order:
1) `Yes`
2) `View diff`
3) `Review in Neovim`
4) `Yes, always this session`
5) `No`

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Observed order exactly:
  1) Yes
  2) View diff
  3) Review in Neovim
  4) Yes, always this session
  5) No

### AC-1B (edit)
Steps:
1. Trigger an `edit` tool call.
2. Inspect approval options.

Expected order:
1) `Yes`
2) `View diff`
3) `Review in Neovim`
4) `Yes, always this session`
5) `No`

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Same prompt/order as AC-1A.

---

## AC-2: No-change Neovim review returns directly to original menu

### AC-2A (write, no changes)
Steps:
1. Trigger `write`.
2. Choose `Review in Neovim`.
3. Make no edits in Neovim, then quit.
4. Observe next prompt.

Expected:
- Returns directly to original approval menu.
- No intermediate apply/back prompt.

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Returned directly to original approval menu.
- No intermediate apply/back prompt shown.
- UX issue observed: Neovim looked partially stuck (`Working` shown), difficult text input/exit.

### AC-2B (edit, no changes)
Steps:
1. Trigger `edit`.
2. Choose `Review in Neovim`.
3. Make no edits in Neovim, then quit.
4. Observe next prompt.

Expected:
- Returns directly to original approval menu.
- No intermediate apply/back prompt.

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Initial attempt failed due to invalid edit payload (`edits[0].oldText` empty), showing `Review in Neovim unavailable...`.
- Retest with valid edit: returned directly to original approval menu with no intermediate prompt.

---

## AC-3: Changed Neovim review shows intermediate decision

### AC-3A (write, changed)
Steps:
1. Trigger `write`.
2. Choose `Review in Neovim`.
3. Modify proposed content, save, quit.
4. Observe intermediate prompt.

Expected exact options:
- `Apply reviewed version`
- `Back to approval menu`

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Prompt showed exactly: `Apply reviewed version` and `Back to approval menu`.

### AC-3B (edit, changed)
Steps:
1. Trigger `edit`.
2. Choose `Review in Neovim`.
3. Modify proposed content, save, quit.
4. Observe intermediate prompt.

Expected exact options:
- `Apply reviewed version`
- `Back to approval menu`

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Prompt showed exactly: `Apply reviewed version` and `Back to approval menu`.

---

## AC-4: Apply reviewed version writes file and blocks original call

### AC-4A (without `ai:`)
Steps:
1. Produce changed reviewed content in Neovim.
2. Choose `Apply reviewed version`.
3. Inspect file on disk.
4. Inspect tool-call result behavior/reason.

Expected:
- Reviewed content persisted to target file.
- Original tool call blocked (agent does not overwrite).
- Technical block reason returned.

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Reviewed content was written to disk.
- Original tool call was blocked and did not overwrite reviewed content.
- Technical block reason was shown.

---

## AC-5: `ai:` comments trigger steer message

### AC-5A (with `ai:`)
Steps:
1. Produce changed reviewed content containing one or more `ai:` lines/comments.
2. Choose `Apply reviewed version`.
3. Verify messaging behavior.

Expected:
- Reviewed content written to file.
- Original tool call blocked.
- Steer message sent with instructions to:
  1) re-read file
  2) follow every `ai:` instruction
  3) remove `ai:` comment lines

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Reviewed content with `ai:` lines was written to file.
- Original tool call was blocked.
- Steer message was sent with the expected 3 instructions.

---

## AC-6: Back-to-menu discards reviewed content from that attempt

### AC-6A
Steps:
1. Produce changed reviewed content in Neovim.
2. At intermediate prompt choose `Back to approval menu`.
3. Verify no write occurred from that reviewed attempt.
4. Confirm original approval loop continues.

Expected:
- No reviewed-content write from this attempt.
- Back at original approval menu.

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- `Back to approval menu` discarded reviewed content from that attempt.
- No write was applied from reviewed buffer.
- Original approval menu was shown again.

---

## AC-7: Neovim unavailable/failure is non-fatal

### AC-7A (simulate unavailable nvim)
Steps:
1. Run with `nvim` unavailable (e.g., altered PATH in test shell).
2. Trigger `edit` or `write`.
3. Choose `Review in Neovim`.

Expected:
- Contextual `Review in Neovim unavailable ...` message.
- Approval flow continues (user can still choose other options).

Result:
- [x] PASS
- [ ] FAIL

Evidence/notes:
- Observed message: `Review in Neovim unavailable: failed to launch nvim: spawnSync nvim ENOENT`.
- Approval prompt remained active with standard options (`Yes`, `View diff`, etc.).

---

## Regression sanity checks

### Standard flows
- [x] `Yes` still allows execution.
- [x] `No` still blocks execution.
- [x] Optional deny reason still works.
- [x] `View diff` still works for `edit`.
- [x] `View diff` still works for `write`.
- [x] `Yes, always this session` still works for non-bash tools.
- [x] `bash` still does not persist session allow-list behavior.

Notes:
- All regression sanity checks passed.

---

## Final QA verdict

- [x] All AC-1..AC-7 passed
- [ ] Regressions detected (describe below)

Summary:
- Manual QA completed successfully.
- AC-1 through AC-7 passed.
- No functional regressions detected.
- Minor UX note captured: intermittent Neovim interaction sluggishness/"Working" state during review in some runs.
