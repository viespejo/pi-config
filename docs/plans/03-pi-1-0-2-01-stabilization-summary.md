# Pi 1.0.2 Stabilization Summary

## Final status

Plan `03-pi-1-0-2-01-stabilization.md` completed successfully.

The installed global Pi was not upgraded and still reports `0.85.1`.

## Acceptance criteria

| Acceptance criterion | Status | Evidence |
|---|---|---|
| AC-1: Abandoned extensions are retired safely | Pass | Removed the global `review.ts` discovery link and deleted the untracked `extensions/review.ts` and `extensions/dcp/` sources. DCP had no global discovery link. Permission Gate review/preview files and tests remain intact. |
| AC-2: Custom providers satisfy Pi 1.0.2 contracts | Pass (mocked) | Gemini uses normalized transcript state and all request hooks. Vertex Anthropic preserves request options. Vertex MaaS uses `/compat`, scoped environment, and cancellable async token setup. Provider mock tests pass. Live checks remain intentionally deferred to Plan 02. |
| AC-3: Host dependencies are coherent | Pass | All Pi host packages resolve to 1.0.2 in the clean target tree; TypeBox resolves to 1.3.27. Extension manifests keep host packages in peer/dev dependencies, not runtime dependencies. |
| AC-4: Retained extensions are statically clean | Pass | Root and every per-extension typecheck pass against Pi 1.0.2. |
| AC-5: Existing behavior remains covered | Pass | All retained test suites and new provider contract tests pass from a clean install. |
| AC-6: Target runtime startup is stable | Pass | Combined RPC, regular TUI, fullscreen TUI, built-in collision, and symlink-layout startup checks pass under Pi 1.0.2. |

## Retirement changes

Removed:

- `/home/its32ve1/.pi/agent/extensions/review.ts` symlink
- `extensions/review.ts`
- `extensions/dcp/`

Preserved:

- `extensions/permission-gate/neovim-review.ts`
- `extensions/permission-gate/edit-preview.ts`
- `extensions/permission-gate/write-preview.ts`
- all associated Permission Gate tests

No `/review`, `/end-review`, or `/dcp` command remains in the retained runtime inventory.

## Provider migrations

### Gemini CLI

`extensions/gemini-cli-provider/src/stream.ts` now:

- accepts `TranscriptContext`;
- resolves the current system prompt and tools through Pi 1.0.2 transcript helpers;
- retains a legacy fallback so the source still loads under the installed Pi 0.85.1 during the transition;
- uses `JsonObject` for tool arguments;
- starts assistant messages with a pending stop reason;
- emits one `start` after successful request setup;
- uses `options.fetch` for initial requests and retries;
- applies `onPayload` replacements;
- calls `onResponse` before consuming the body;
- calls `onProviderStreamEvent` for parsed provider events;
- preserves custom headers and abort signals;
- avoids retries for non-retryable HTTP responses.

Gemini tests now cover:

- normalized prompt and tools;
- instrumentation hooks;
- balanced text events;
- tool calls and prior tool results;
- pre-aborted requests;
- empty-stream retries;
- malformed SSE events;
- Unicode split across byte chunks;
- usage and cost;
- non-retryable HTTP failures.

Result: 18 tests passed.

### Vertex Anthropic

`extensions/vertex-anthropic/index.ts` now:

- preserves the complete supported request options object;
- forwards hooks, environment, transport, metadata, timeout, retries, cache, headers, session, and signal fields;
- allows provider-scoped environment to override project and region per request;
- passes custom fetch, timeout, and retry settings into the Vertex SDK client;
- overrides only client, max-token cap, and mapped thinking fields.

A mock delegation test verifies normalized context identity, option preservation, thinking mapping, token cap, project, and region.

Result: 1 test passed.

### Vertex MaaS

`extensions/vertex-maas/index.ts` now:

- imports `getApiProvider` from `@earendil-works/pi-ai/compat`;
- preserves the complete request options object;
- resolves project, region, and access token from provider-scoped environment first;
- uses `lazyStream()` for asynchronous credential setup;
- replaces synchronous `execSync` with abortable `execFile`;
- constructs the per-request endpoint from scoped project and region.

A mock delegation test verifies normalized context, endpoint, scoped token, signal, headers, and instrumentation hooks without running `gcloud` or accessing the network.

Result: 1 test passed.

### OpenAI Codex Work

The provider source required no behavioral migration. OAuth test fixtures now include the required 1.0.2 credential discriminant.

Result: typecheck passed and 2 tests passed.

## Retained source compatibility fixes

### Answer

- Uses `completeSimple` through the compatibility entrypoint.
- Uses the Pi 1.0.2 `SelectListTheme` fields.
- Keeps the extraction reasoning value as a typed literal.

### Files

- Narrows expanded Pi 1.0.2 message unions before reading `content`.

### Todo

- Uses host-provided `typebox` instead of `@sinclair/typebox`.
- Narrows optional settings and discriminated tool details correctly.
- Uses the public `KeybindingsManager` contract.
- Preserves the post-dialog render request without relying on invalid closure narrowing.

## Dependency layout

All extension manifests now declare imported host packages under `peerDependencies` with `"*"` and use Pi 1.0.2 only as development dependencies.

The clean root target resolves:

- `@earendil-works/pi-ai@1.0.2`
- `@earendil-works/pi-agent-core@1.0.2`
- `@earendil-works/pi-coding-agent@1.0.2`
- `@earendil-works/pi-tui@1.0.2`
- `typebox@1.3.27`

No extension runtime `dependencies` field contains a host-provided Pi package.

Local symlink loading requires non-host runtime dependencies to exist beside their extension because module resolution begins under `~/.pi/agent/extensions`. The following production-only local installs are therefore intentional:

- Permission Gate: `diff@8.0.4`
- Planning: `yaml@2.9.0`
- Vertex Anthropic: `@anthropic-ai/vertex-sdk@0.16.0` and its transitive dependencies

These local runtime trees contain no Pi host package and no TypeBox copy.

## Clean-install verification

Clean target tree:

- `/tmp/pi-stabilization-1.0.2`

Installation:

- `npm ci --ignore-scripts --no-audit --no-fund`: pass
- single Pi 1.0.2 dependency family: pass
- TypeBox deduplication to 1.3.27: pass

Typechecks:

- root: pass
- Gemini CLI: pass
- Codex Work: pass
- Permission Gate: pass
- Planning: pass
- Usage: pass
- Vertex Anthropic: pass
- Vertex MaaS: pass

Tests:

- Gemini CLI: 18 passed
- Codex Work: 2 passed
- Permission Gate: 64 passed
- Planning: 45 passed
- Usage: 4 passed
- Vertex Anthropic: 1 passed
- Vertex MaaS: 1 passed
- root pi-editor suite: 28 passed

Lint:

- 0 errors
- 3 pre-existing warnings

## Runtime inventory

Combined Pi 1.0.2 startup with built-ins:

- tools: 12
- active tools: 5
- commands: 19
- custom-provider models: 20

Active tools:

- `read`
- `bash`
- `edit`
- `write`
- `todo`

Built-in tools coexist without collision:

- `codemode` (`model-only`)
- `tool_search` (`model-only`)

Custom provider models:

- Gemini CLI: 3
- Vertex Anthropic: 4
- Vertex MaaS: 4
- Codex Work: 9

Startup results:

- clean-agent RPC: pass
- regular TUI: pass
- fullscreen TUI: pass
- built-ins plus retained local extensions: pass
- temporary global-style symlink layout: pass

## Current-runtime safety

The modified retained extensions were also loaded together under the still-installed Pi 0.85.1:

- explicit clean-agent startup: pass
- real global configuration in offline RPC mode: pass
- installed version after all work: `0.85.1`

The first real-layout check exposed missing local Vertex SDK resolution after removing nested runtime dependencies. Installing only non-host production dependencies beside the relevant symlinked packages resolved it. The repeated real-configuration startup passed.

## Files added

- `extensions/permission-gate/tsconfig.json`
- `extensions/usage/tsconfig.json`
- `extensions/vertex-anthropic/tests/provider.test.ts`
- `extensions/vertex-maas/package-lock.json`
- `extensions/vertex-maas/tests/provider.test.ts`
- `docs/plans/03-pi-1-0-2-01-stabilization.md`
- `docs/plans/03-pi-1-0-2-02-upgrade.md`
- `docs/plans/03-pi-1-0-2-01-stabilization-summary.md`

The plan index was updated in `docs/plans/README.md`.

## Plan 02 prerequisites and remaining work

The following items remain intentionally unresolved until Plan 02:

1. Audit configured third-party packages under Pi 1.0.2:
   - `@codexstar/pi-listen`
   - `pi-mermaid`
   - `pi-extension-manager`
   - `pi-resource-center`
2. Run redacted live checks for Gemini CLI, Vertex Anthropic, Vertex MaaS, and Codex Work.
3. Create and inspect the private rollback snapshot.
4. Select and explicitly approve the installation route and command.
5. Upgrade only after those gates pass.

Do not run `pi update --all`.
