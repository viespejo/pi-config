---
phase: 03-pi-1-0-2
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - extensions/review.ts
  - extensions/dcp/
  - extensions/gemini-cli-provider/src/stream.ts
  - extensions/gemini-cli-provider/test/stream.test.ts
  - extensions/vertex-anthropic/index.ts
  - extensions/vertex-anthropic/tests/provider.test.ts
  - extensions/vertex-maas/index.ts
  - extensions/vertex-maas/tests/provider.test.ts
  - extensions/answer.ts
  - extensions/files.ts
  - extensions/todo.ts
  - extensions/usage/package.json
  - extensions/*/package.json
  - package.json
  - package-lock.json
  - tsconfig.json
runtime_changes:
  - /home/its32ve1/.pi/agent/extensions/review.ts
  - /home/its32ve1/.pi/agent/extensions/dcp
  - /home/its32ve1/.pi/agent/extensions/*
autonomous: false
---

<objective>
## Goal
Make every retained local extension compile, test, and load against Pi 1.0.2 in an isolated environment while keeping the installed global Pi at 0.85.1.

## Purpose
Remove abandoned extensions, migrate provider contracts, eliminate duplicate Pi module roots, and resolve the retained extensions' pre-existing type errors before changing the user's installed runtime.

## Output
- `review.ts` and `dcp/` are retired rather than migrated.
- Gemini CLI, Vertex Anthropic, and Vertex MaaS satisfy the Pi 1.0.2 provider contracts.
- Retained extension manifests use one coherent host dependency policy.
- All retained extensions pass isolated typechecks, tests, and startup checks on 1.0.2.
- The global Pi installation remains at 0.85.1 throughout this plan.
</objective>

<context>
Primary references:
- `/tmp/pi-upgrade-compatibility-report.md`
- Pi 1.0.2 `docs/extensions.md`
- Pi 1.0.2 `docs/custom-provider.md`
- Pi 1.0.2 `docs/packages.md`
- Pi 1.0.2 `docs/tui.md`

Locked decisions:
- Do not continue or repair `extensions/review.ts` or `extensions/dcp/`.
- Do not confuse `extensions/review.ts` with Permission Gate's Neovim review modules; Permission Gate remains in scope and must be preserved.
- Do not run `pi update`, `pi update --all`, or a global npm upgrade in this plan.
- Keep a clean comparison between upgrade regressions and pre-existing source issues.
- Generated source, tests, manifests, and documentation must remain in English.
</context>

<acceptance_criteria>
## AC-1: Abandoned extensions are retired safely
Given Review and DCP are no longer wanted
When stabilization completes
Then their global discovery links and repository sources are absent, no settings reference remains, and Permission Gate review functionality is untouched.

## AC-2: Custom providers satisfy Pi 1.0.2 contracts
Given normalized transcript contexts and request instrumentation
When each custom provider streams a mocked response
Then prompts, tools, tool results, cancellation, instrumentation hooks, and terminal stream events are handled according to Pi 1.0.2.

## AC-3: Host dependencies are coherent
Given all retained local extensions
When dependencies are installed from a clean checkout
Then runtime resolution uses one Pi 1.0.2 host module root, package manifests do not bundle host-provided Pi packages, and TypeBox variants are not mixed.

## AC-4: Retained extensions are statically clean
Given the target dependency tree
When per-extension and root typechecks run
Then no retained extension reports a TypeScript error.

## AC-5: Existing behavior remains covered
Given the retained extension test suites
When tests run against 1.0.2
Then all existing and new provider contract tests pass.

## AC-6: Target runtime startup is stable
Given a clean temporary Pi agent directory
When all retained extensions load together in RPC, regular TUI, and fullscreen TUI modes
Then startup and shutdown complete without extension errors, duplicate classes, or resource collisions.
</acceptance_criteria>

<tasks>
<task type="manual-confirmed">
  <name>Retire Review and DCP without affecting Permission Gate</name>
  <files>extensions/review.ts, extensions/dcp/, /home/its32ve1/.pi/agent/extensions/review.ts, /home/its32ve1/.pi/agent/extensions/dcp</files>
  <action>
    1. Record the current Git status and global extension symlink inventory.
    2. Remove the global `review.ts` discovery symlink.
    3. Remove a DCP discovery link if one exists; absence is acceptable.
    4. Delete `extensions/review.ts` and `extensions/dcp/` from the workspace.
    5. Search settings, manifests, scripts, and documentation for stale Review/DCP registrations.
    6. Do not delete or rename `extensions/permission-gate/neovim-review.ts`, its tests, or any Permission Gate preview/review behavior.
  </action>
  <verify>
    `find ~/.pi/agent/extensions -maxdepth 1 -type l -printf '%f -> %l\n' | sort` and `rg -n 'extensions/(review|dcp)|review\.ts|\bdcp\b' --glob '!node_modules/**' .`
  </verify>
  <done>AC-1 satisfied</done>
</task>

<task type="auto">
  <name>Migrate the Gemini CLI stream to TranscriptContext</name>
  <files>extensions/gemini-cli-provider/src/stream.ts, extensions/gemini-cli-provider/test/stream.test.ts</files>
  <action>
    1. Replace the legacy `Context` provider signature with `TranscriptContext`.
    2. Resolve the current prompt and tools with `getCurrentSystemPrompt()` and `getCurrentTools()`; use transcript collapse helpers only if required by the Gemini protocol.
    3. Use Pi's `JsonObject`/`JsonValue` types for tool-call arguments and validate unknown provider values before assignment.
    4. Initialize assistant messages with `stopReason: "pending"`.
    5. Emit exactly one `start` after request setup succeeds, balanced content events, and exactly one terminal `done` or `error`.
    6. Use `options.fetch ?? globalThis.fetch` for every initial request and retry.
    7. Apply replacement payloads returned by `onPayload`, call `onResponse` before body consumption, and await `onProviderStreamEvent` for every parsed provider event.
    8. Preserve `signal`, provider-scoped `env`, headers, and request options where applicable.
    9. Normalize aborts to an aborted assistant result.
    10. Keep current endpoint, retry policy, signature handling, and model validation unless contract compliance requires a targeted change.
  </action>
  <verify>`npm --prefix extensions/gemini-cli-provider run check && npm --prefix extensions/gemini-cli-provider test` in the isolated 1.0.2 tree</verify>
  <done>Gemini portion of AC-2 and AC-5 satisfied</done>
</task>

<task type="auto">
  <name>Preserve request options in Vertex Anthropic</name>
  <files>extensions/vertex-anthropic/index.ts, extensions/vertex-anthropic/tests/provider.test.ts, extensions/vertex-anthropic/package.json</files>
  <action>
    1. Preserve all supported `SimpleStreamOptions` while overriding only the Vertex client, max-token cap, and mapped thinking fields.
    2. Forward `fetch`, `env`, `onPayload`, `onResponse`, `onProviderStreamEvent`, signal, headers, metadata, timeout, retry, cache, and session fields where supported by the underlying Anthropic adapter.
    3. Keep `TranscriptContext` unchanged when delegating.
    4. Add a mock API-provider test that verifies context identity, headers, cache retention, thinking mapping, abort signal, and instrumentation callbacks.
    5. Do not perform live Vertex requests in unit tests.
  </action>
  <verify>`npm --prefix extensions/vertex-anthropic run typecheck` plus the new mock test in the isolated 1.0.2 tree</verify>
  <done>Vertex Anthropic portion of AC-2 and AC-5 satisfied</done>
</task>

<task type="auto">
  <name>Migrate Vertex MaaS compatibility import and auth plumbing</name>
  <files>extensions/vertex-maas/index.ts, extensions/vertex-maas/tests/provider.test.ts, extensions/vertex-maas/package.json</files>
  <action>
    1. Import `getApiProvider` from `@earendil-works/pi-ai/compat`.
    2. Keep delegation to the built-in OpenAI Completions implementation and preserve the complete options object.
    3. Resolve token-related values from provider-scoped `options.env` before `process.env`.
    4. Replace or isolate synchronous `gcloud` execution so cancellation and deterministic tests are possible; preserve the environment-token fast path.
    5. Add mock tests for normalized context, tools, auth override, hooks, abort, and error propagation.
  </action>
  <verify>`npm --prefix extensions/vertex-maas run typecheck` plus the new mock test in the isolated 1.0.2 tree</verify>
  <done>Vertex MaaS portion of AC-2 and AC-5 satisfied</done>
</task>

<task type="auto">
  <name>Normalize extension dependency manifests</name>
  <files>package.json, package-lock.json, extensions/*/package.json, extensions/*/package-lock.json</files>
  <action>
    1. Declare imported host packages (`pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, and `typebox`) as `peerDependencies` with `"*"` only where used.
    2. Keep target 1.0.2 packages as development dependencies where local standalone checks require them; never bundle host packages as runtime dependencies.
    3. Move Usage's Pi packages out of `dependencies`.
    4. Add complete manifests and scripts for Vertex MaaS and Permission Gate where missing.
    5. Replace direct `@sinclair/typebox` use with host-provided `typebox`.
    6. Keep non-host runtime dependencies such as `yaml`, `diff`, and the Vertex SDK in `dependencies`.
    7. Regenerate lockfiles from clean installs and verify that runtime checks do not resolve mixed Pi versions.
    8. Avoid introducing npm workspaces unless direct root resolution cannot provide reproducible checks.
  </action>
  <verify>`npm ls @earendil-works/pi-ai @earendil-works/pi-agent-core @earendil-works/pi-coding-agent @earendil-works/pi-tui --all` and package-manifest inspection</verify>
  <done>AC-3 satisfied</done>
</task>

<task type="auto">
  <name>Resolve retained pre-existing type errors</name>
  <files>extensions/answer.ts, extensions/files.ts, extensions/todo.ts, tsconfig.json, package.json</files>
  <action>
    1. In Answer, replace the removed global model helper with `ctx.modelRegistry.streamSimple()` where context is available; adapt the target `SelectListTheme` shape and callback types without changing UX.
    2. In Files, narrow `AgentMessage` by role/content capability before reading `.content`.
    3. In Todo, use `typebox`, align tool parameter schemas with Pi's `TSchema`, narrow discriminated detail unions, and adapt keybinding/TUI types to 1.0.2.
    4. Keep behavior and rendering unchanged except where the target public API requires adaptation.
    5. Do not perform unrelated refactors.
    6. Exclude retired Review/DCP sources because they no longer exist; do not hide errors by excluding retained extensions.
  </action>
  <verify>`npm run typecheck`, per-extension typechecks, and retained test suites in the isolated 1.0.2 tree</verify>
  <done>AC-4 satisfied</done>
</task>

<task type="auto">
  <name>Run the complete retained-extension target matrix</name>
  <files>No production files unless a test exposes a scoped migration defect</files>
  <action>
    1. Recreate a clean `/tmp` compatibility tree from the workspace.
    2. Install one Pi 1.0.2 dependency family with required third-party runtime packages.
    3. Run all per-extension typechecks and tests.
    4. Load every retained extension individually and together with an empty `PI_CODING_AGENT_DIR` and `PI_OFFLINE=1`.
    5. Compare command, tool, active-tool, and provider inventories with the accepted baseline.
    6. Run immediate startup/shutdown checks in RPC, regular TUI, and fullscreen TUI modes.
    7. Verify no Review or DCP command remains and no Permission Gate capability was lost.
  </action>
  <verify>All matrix rows pass and logs contain no extension load error, duplicate host class, or resource collision</verify>
  <done>AC-5 and AC-6 satisfied</done>
</task>
</tasks>

<boundaries>
## DO NOT CHANGE
- Do not upgrade the installed global Pi in this plan.
- Do not run `pi update --all`.
- Do not alter real credentials, auth files, or session files.
- Do not remove Permission Gate's Neovim review functionality.
- Do not redesign extension UX or provider model catalogs beyond compatibility requirements.

## SCOPE LIMITS
- Live provider calls are deferred to Plan 02.
- Third-party global Pi packages are audited in Plan 02.
- Managed pi.dev installation migration is deferred to Plan 02.
- Preserve a rollback path to global Pi 0.85.1.
</boundaries>

<verification>
Run from the repository root or isolated target copy as appropriate:
1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. Every extension package's typecheck and test script
5. Single-version `npm ls` validation
6. Clean-agent RPC startup
7. Clean-agent regular TUI startup
8. Clean-agent fullscreen TUI startup
9. Command/tool/provider inventory comparison
10. `pi --version` must still report `0.85.1` at the end of this plan
</verification>

<success_criteria>
- Review and DCP are absent and Permission Gate remains intact.
- Every retained extension is type-clean against 1.0.2.
- Every retained automated test passes.
- Provider contract tests cover normalized context and instrumentation.
- No mixed Pi runtime dependency roots remain.
- Combined extension startup passes in RPC and both TUI modes.
- The installed Pi remains unchanged at 0.85.1.
</success_criteria>

<output>
Produce `docs/plans/03-pi-1-0-2-01-stabilization-summary.md` with:
- AC-by-AC status;
- exact source, manifest, symlink, and lockfile changes;
- dependency tree evidence;
- test and startup command results;
- retained command/tool/provider inventory;
- unresolved live-verification items for Plan 02;
- confirmation that global Pi is still 0.85.1.
</output>
