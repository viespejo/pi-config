# SUMMARY

## 1) Files changed

Created/modified:

- `.pi/extensions/gemini-cli-provider/index.ts`
- `.pi/extensions/gemini-cli-provider/provider.ts`
- `.pi/extensions/gemini-cli-provider/oauth.ts`
- `.pi/extensions/gemini-cli-provider/stream.ts`
- `.pi/extensions/gemini-cli-provider/doctor.ts`
- `.pi/extensions/gemini-cli-provider/types.ts`
- `.pi/extensions/gemini-cli-provider/redaction.ts`
- `.pi/extensions/gemini-cli-provider/README.md`
- `.pi/extensions/gemini-cli-provider/test/provider.test.ts`
- `.pi/extensions/gemini-cli-provider/test/doctor.test.ts`
- `.pi/extensions/gemini-cli-provider/test/stream.test.ts`
- `.pi/extensions/gemini-cli-provider/SUMMARY.md`

## 2) Decision mapping

- `types.ts`
  - Provider constants and model policy contract (`google-gemini-cli`, 3-model catalog, default model).
  - Unsupported model explicit error contract.
  - Doctor contract types and stable check IDs.

- `provider.ts`
  - Registers OAuth-only provider config for `google-gemini-cli`.
  - Fixed endpoint `https://cloudcode-pa.googleapis.com`.
  - Exact 3 approved models, default effective by order: `gemini-3.1-pro-preview` first.

- `oauth.ts`
  - Historical-style Gemini CLI OAuth flow (login, refresh, project discovery).
  - Standard Pi OAuth storage integration via provider oauth config.
  - No API-key fallback.

- `stream.ts`
  - Dedicated Gemini CLI SSE implementation for Cloud Code Assist endpoint.
  - Explicit supported-model validation; unsupported model fails with actionable error.
  - Uses fixed endpoint, no endpoint override path.

- `doctor.ts`
  - Registers behavior for `/gemini-cli-doctor` contract through command handler integration.
  - Implements `--json`, `--live`, `--model`, `--timeout`, `--verbose`.
  - No network by default; live probe only with `--live`.
  - Global status aggregation (`ok|warn|fail`) and non-interactive exit policy (`fail => 1`).

- `redaction.ts`
  - Strict redaction helpers for human and JSON outputs.

- `index.ts`
  - Extension composition root:
    - provider registration (`google-gemini-cli`)
    - command registration (`gemini-cli-doctor`, i.e. `/gemini-cli-doctor`)

- `README.md`
  - Local operational docs: activation, OAuth, supported models/default, unsupported model policy, doctor usage/troubleshooting.

- Tests (`test/*.test.ts`)
  - Regression coverage for provider identity/model policy, doctor contract, and dedicated stream behavior.

## 3) Manual validation checklist + results

- [PASS] Provider ID is exactly `google-gemini-cli`.
  - Evidence: `types.ts`, `index.ts`, `provider.ts` constants/registration.

- [PASS] No `google-antigravity` logic added in extension sources.
  - Evidence: extension source files contain no antigravity branches or IDs.

- [PASS] Fixed endpoint policy enforced (`https://cloudcode-pa.googleapis.com`).
  - Evidence: `provider.ts` baseUrl and `stream.ts` request URL are fixed.

- [PASS] OAuth-only behavior (no API-key fallback).
  - Evidence: `oauth.ts` + `types.ts` parse/validation messages and provider oauth wiring.

- [PASS] Unsupported model fails explicitly and actionably.
  - Evidence: `types.ts#createUnsupportedModelError`, used by stream/doctor.

- [PASS] `/gemini-cli-doctor` default mode is stateless and no-network.
  - Evidence: implemented checks are local-only unless `--live`; verified by automated test.

- [NOT RUN] Interactive smoke in tmux.
  - Reason: this execution focused on code + automated regressions.

## 4) Automated regression results (phase 1.1)

### Added tests

- `.pi/extensions/gemini-cli-provider/test/provider.test.ts`
- `.pi/extensions/gemini-cli-provider/test/doctor.test.ts`
- `.pi/extensions/gemini-cli-provider/test/stream.test.ts`

### Command executed

```bash
npx tsx ./node_modules/vitest/dist/cli.js --run \
  .pi/extensions/gemini-cli-provider/test/provider.test.ts \
  .pi/extensions/gemini-cli-provider/test/doctor.test.ts \
  .pi/extensions/gemini-cli-provider/test/stream.test.ts
```

### Result

- PASS: 3 test files, 11 tests passed.

## 5) Contract gaps / blockers

### External repo blocker

`npm run check` fails due to pre-existing errors outside this extension:

- `packages/coding-agent/examples/extensions/sandbox/index.ts`
  - missing `@anthropic-ai/sandbox-runtime`
  - incompatible `SandboxConfig` fields (`network`, `filesystem`)

Impact:

- Prevents global green `npm run check` despite extension tests passing.
- Not caused by this extension changes.

### Scope notes

- Interactive manual smoke (`/login`, `/gemini-cli-doctor --live`, `--model google-gemini-cli/<id>`) not executed in this run.
- No additional scope beyond approved v1 decisions was introduced.
