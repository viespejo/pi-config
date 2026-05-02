# Gemini CLI Provider Extension (local)

This extension restores `google-gemini-cli` as a **project-local** provider.

## Scope (v1)

- Provider ID: `google-gemini-cli`
- OAuth only (no API key fallback)
- Fixed endpoint: `https://cloudcode-pa.googleapis.com`
- Supported models:
  - `gemini-3-flash-preview`
  - `gemini-3.1-flash-lite-preview`
  - `gemini-3.1-pro-preview` (default)
- Dedicated Gemini CLI stream path (not `google-generative-ai`)
- Diagnostics command: `/gemini-cli-doctor`

Out of scope in v1:

- `google-antigravity`
- Endpoint override
- Additional model catalog entries

## Local activation

Place the extension under your project at:

- `.pi/extensions/gemini-cli-provider/`

Pi will load project extensions from `.pi/extensions`.

## Login and auth

This provider is OAuth-only and appears in `/login` as:

- `Google Gemini CLI`

Authenticate with:

- `/login google-gemini-cli`

Credentials are stored via Pi standard OAuth storage.

## Model selection

Use the contractual format:

- `--model google-gemini-cli/<id>`

Example:

- `--model google-gemini-cli/gemini-3.1-pro-preview`

If an unsupported model is requested, the extension fails explicitly and includes:

- provider id
- requested model id
- supported model list

## Diagnostics

Run:

- `/gemini-cli-doctor`

Flags:

- `--json` output one final JSON line
- `--live` run live E2E probe (network)
- `--model <id>` model for `--live` (default: `gemini-3.1-pro-preview`)
- `--timeout <seconds>` live probe timeout (default: `20`)
- `--verbose` include extra details in human output

Behavior:

- No network by default (without `--live`)
- Global status: `ok | warn | fail`
- Non-interactive exit policy: `ok/warn => 0`, `fail => 1`
- Redaction is applied to sensitive values in human and JSON outputs

## Troubleshooting

### OAuth missing or expired

Symptoms:

- provider calls fail with OAuth remediation
- doctor reports OAuth check as `fail`

Action:

1. Run `/login google-gemini-cli`
2. Complete browser flow
3. Re-run `/gemini-cli-doctor --json`

### Unsupported model

Symptoms:

- explicit unsupported-model error

Action:

- switch to one of the 3 supported model IDs listed above

### Live probe fails

Symptoms:

- `/gemini-cli-doctor --live` reports `fail`

Action:

1. Validate OAuth login
2. Verify network access to `cloudcode-pa.googleapis.com`
3. Retry with a higher timeout, e.g. `--timeout 40`
