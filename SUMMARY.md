1. **Implemented Files**
   - `scripts/pi-editor-context.mjs` — Main Node wrapper implementing config resolution, session discovery, branch parsing, context injection, editor launch, prompt-only export, policies, and debug logging.
   - `scripts/pi-editor-context` — POSIX launcher for direct `EDITOR`/`VISUAL` usage that delegates to the Node wrapper.
   - `/home/its32ve1/.config/nvim/lua/plugins/sidekick.lua` — External Neovim config updated to inject `EDITOR`/`VISUAL` under `cli.tools.pi.env` (PI-only scope).
   - `docs/sidekick-integration-notes.md` — Repository-tracked record of the external Sidekick integration (outside repo tree).
   - `docs/pi-editor-context-technical-spec.md` — Normative technical reference used during implementation (preserved).

2. **Configuration Resolved**
   Effective runtime config captured from debug log (precedence test run):

   - Source scenario:
     - User config (`~/.config/pi-editor-context/config.json` under isolated `HOME`) set `messages=2`, `maxPerMessage=150`, `openMode=nvim`, `errorPolicy=soft`.
     - Project config (`.pi/editor-context.json` under isolated CWD hint) set `messages=4`, `maxPerMessage=120`, `maxChars=777`, `openMode=nvr`.
     - Env set `PI_EDITOR_CONTEXT_MESSAGES=9`, `PI_EDITOR_CONTEXT_MAX_CHARS=555`, `PI_EDITOR_OPEN_MODE=nvim`, plus explicit `PI_EDITOR_CONTEXT_SESSION_FILE`.

   - Effective values (from debug):
     - `messages: 9` (env over project/user)
     - `maxChars: 555` (env over project/default)
     - `maxPerMessage: 120` (project over user)
     - `openMode: "nvim"` (env over project)
     - `errorPolicy: "soft"` (user over defaults)
     - `sessionFile: /home/its32ve1/code/pi-config/.tmp/plan01-task1-tests/sessions/--home-its32ve1-code-pi-config--/long-fixture.jsonl`
     - `selectedLeafId: "u2"`
     - `injectedCount: 3`

3. **Verification Evidence**
   - Commands executed.
   - Observed outputs.
   - Pass/fail per AC.

   **A) Baseline (no sessions found, fail-open behavior)**
   - Command:
     - `PATH="$PWD/.tmp/plan01-task1-tests/fakebin:$PATH" PI_EDITOR_OPEN_MODE=nvim PI_EDITOR_SESSIONS_DIR="$PWD/.tmp/plan01-task1-tests/empty-sessions" PI_FAKE_EDITOR_MODE=noop node scripts/pi-editor-context.mjs .tmp/plan01-task1-tests/work/pi-temp-1.txt`
   - Output:
     - `EXIT:0`
     - Result file remained valid prompt body (`Base prompt line`).
   - Result:
     - AC-3: **PASS** (workflow stays usable when no session is found).

   **B) Branch fixture (accurate leaf path extraction)**
   - Command:
     - `PATH="$PWD/.tmp/plan01-task1-tests/fakebin:$PATH" PI_EDITOR_OPEN_MODE=nvim PI_EDITOR_SESSIONS_DIR="$PWD/.tmp/plan01-task1-tests/sessions" PI_FAKE_EDITOR_MODE=noop PI_FAKE_EDITOR_SNAPSHOT="$PWD/.tmp/plan01-task1-tests/work/branch-working-snapshot.md" node scripts/pi-editor-context.mjs .tmp/plan01-task1-tests/work/pi-temp-2.txt`
   - Observed working snapshot:
     - Context included `U: Root question`, `A: Root answer`, `U: Right branch user FINAL`, `A: Right branch assistant FINAL`.
     - Left branch messages were not included.
   - Result:
     - AC-1: **PASS** (branch reconstruction by `id`/`parentId`, correct recent leaf branch).

   **C) Marker export isolation**
   - Command:
     - `PATH="$PWD/.tmp/plan01-task1-tests/fakebin:$PATH" PI_EDITOR_OPEN_MODE=nvim PI_EDITOR_SESSIONS_DIR="$PWD/.tmp/plan01-task1-tests/sessions" PI_FAKE_EDITOR_MODE=marker-export node scripts/pi-editor-context.mjs .tmp/plan01-task1-tests/work/pi-temp-3.txt`
   - Output:
     - `EXIT:0`
     - PI temp output contained `PROMPT_EDIT_SHOULD_EXPORT`.
     - Grep check returned `CONTEXT_NOT_EXPORTED` for context-only edit marker.
   - Result:
     - AC-2: **PASS** (only prompt section after `PI_PROMPT_START` is exported).

   **D) Size/format/sanitization limits**
   - Commands:
     - Low limits: `PI_EDITOR_CONTEXT_MAX_PER_MESSAGE=20 PI_EDITOR_CONTEXT_MAX_CHARS=60 ...`
     - Multiline format: `PI_EDITOR_CONTEXT_MAX_PER_MESSAGE=200 PI_EDITOR_CONTEXT_MAX_CHARS=1000 ...`
   - Observed outputs:
     - Truncation evidence in context snapshot (`A: Assistant red conte…`, `U: Final user payload …`).
     - Multiline format evidence:
       - first line prefixed with `U:`/`A:`
       - continuation line indented (`   ...`).
     - ANSI/control stripped (no ANSI escapes preserved in output text).
   - Result:
     - AC-6: **PASS**.

   **E) Error policy soft vs hard**
   - Commands:
     - Soft: `PI_EDITOR_ERROR_POLICY=soft ... invalid.jsonl ...`
     - Hard: `PI_EDITOR_ERROR_POLICY=hard ... invalid.jsonl ...`
   - Observed outputs:
     - Soft: `EXIT:0`, file contains usable prompt output (`PROMPT_FROM_EDITOR`).
     - Hard: stderr includes `[pi-editor-context] Invalid JSONL at line 2`, `EXIT:1`.
   - Result:
     - AC-3: **PASS**.

   **F) Config precedence (env > project > user > defaults)**
   - Command:
     - isolated `HOME` + isolated CWD hint + env overrides + `PI_EDITOR_DEBUG=1`.
   - Observed debug log:
     - `messages: 9` from env over project/user.
     - `maxPerMessage: 120` from project over user.
     - `openMode: "nvim"` from env over project.
   - Result:
     - AC-4: **PASS**.

   **G) Launcher path verification (`scripts/pi-editor-context`)**
   - Command:
     - `PATH="$PWD/.tmp/plan01-task1-tests/fakebin:$PATH" ... scripts/pi-editor-context .tmp/plan01-task2-temp.txt`
   - Observed output:
     - `EXIT:0`, prompt updated to `PROMPT_FROM_EDITOR`.
   - Result:
     - Launcher behavior: **PASS**.

   **H) Sidekick integration evidence**
   - Checks:
     - `luac -p /home/its32ve1/.config/nvim/lua/plugins/sidekick.lua` -> `OK`
     - `grep` evidence for `cli.tools.pi.env` with absolute `EDITOR` and `VISUAL` wrapper path.
   - Result:
     - AC-5: **PASS** (configuration-level validation; runtime Sidekick flow wiring is in place).

   **Acceptance Criteria Summary**
   - AC-1: **PASS**
   - AC-2: **PASS**
   - AC-3: **PASS**
   - AC-4: **PASS**
   - AC-5: **PASS**
   - AC-6: **PASS**

4. **Behavioral Guarantees**
   - Context is never exported to PI: export logic writes only text after `<!-- PI_PROMPT_START -->`; context-block edits were explicitly tested and not exported.
   - Fail-open behavior works in soft mode: when discovery/parsing fails, workflow remains usable and does not hard-fail.

5. **Known Limitations / Follow-ups**
   - Sidekick verification was performed via static config + syntax + env wiring evidence; an in-editor interactive smoke pass (Sidekick launch + `Ctrl+G`) should be repeated manually in the target workstation session.
   - Test fixtures are ad-hoc shell-based and live under `.tmp/`; PLAN-02 introduces deterministic automated harness coverage for repeatability.
