# Permission Gate – Neovim Review Wave Summary

## 1) Scope implemented (mapped to AC-1..AC-7)

- **AC-1: Edit/write menu includes Neovim option in fixed order**
  - Added `Review in Neovim` to `edit`/`write` approval options.
  - Final order is:
    1. `Yes`
    2. `View diff`
    3. `Review in Neovim`
    4. `Yes, always this session`
    5. `No`

- **AC-2: No-change Neovim review returns to original menu**
  - `reviewInNeovim` classifies unchanged reviewed content as `no-change`.
  - Approval loop returns directly to the original approval menu without an intermediate decision prompt.

- **AC-3: Changed Neovim review uses explicit intermediate decision**
  - On changed reviewed content, extension prompts with exactly:
    - `Apply reviewed version`
    - `Back to approval menu`

- **AC-4: Apply reviewed version persists manual content and blocks original call**
  - Applying reviewed content writes it to disk at the target path.
  - Extension then blocks the original `edit`/`write` tool call with a technical block reason.

- **AC-5: `ai:` comments trigger steer message**
  - If applied reviewed content contains `ai:`, extension sends `pi.sendUserMessage(..., { deliverAs: "steer" })`.
  - Message instructs the agent to re-read file, follow all `ai:` instructions, and remove `ai:` comment lines.

- **AC-6: Back-to-menu path discards reviewed changes**
  - Choosing `Back to approval menu` returns to original approval loop.
  - No reviewed content write is performed on this path.

- **AC-7: Neovim launch failures are non-fatal to approval flow**
  - Neovim launch/read failures are classified as `unavailable`.
  - Approval loop remains active and shows contextual `Review in Neovim unavailable` message.

## 2) Files changed (exact paths)

- `extensions/permission-gate/index.ts`
- `extensions/permission-gate/prompt-messages.ts`
- `extensions/permission-gate/neovim-review.ts`
- `extensions/permission-gate/tests/prompt-messages.test.ts`
- `extensions/permission-gate/tests/tool-call.test.ts`
- `extensions/permission-gate/tests/neovim-review.test.ts`
- `extensions/permission-gate/README.md`

## 3) Test evidence (commands + pass/fail summary)

- `cd extensions/permission-gate && npm test -- --test-name-pattern "prompt-messages|tool-call"`
  - **PASS**
- `cd extensions/permission-gate && npm test -- --test-name-pattern "neovim-review|tool-call"`
  - **PASS**
- `cd extensions/permission-gate && npm test`
  - **PASS** (52 tests passed, 0 failed)

## 4) Deviations from plan

- No functional deviations from the approved plan were introduced.
- Scope remained inside `extensions/permission-gate/**`.
- No new dependencies were added.

## 5) Follow-up recommendations for next wave (embedded Neovim mode)

- Add optional embedded Neovim integration (`NVIM --server`) as a secondary review backend.
- Keep standalone mode as fallback for environments without embedded server support.
- Add explicit backend selection telemetry/logging to simplify troubleshooting.
- Add tests for backend selection priority and cancellation/race behavior when embedded mode is active.
