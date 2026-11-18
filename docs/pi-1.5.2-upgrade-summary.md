# Pi 1.5.2 Upgrade Summary

## Result

Upgraded all eight local package manifests and their lockfiles, plus the NVM-managed global Pi installation, from 1.5.0 to 1.5.2. Existing host-provided peer dependency declarations remain unchanged. No extension implementation changes were required. Third-party Pi packages were not updated.

Global installation command:

```bash
npm install -g --ignore-scripts --no-fund @earendil-works/pi-coding-agent@1.5.2
```

## Compatibility review

Reviewed the [1.5.1 and 1.5.2 release notes](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/CHANGELOG.md) and installed extension/package documentation.

- The deprecated `GrepOperations.readFile` context callback change does not affect these extensions: no custom grep operations are used.
- Omitting empty OpenAI-compatible `tools` arrays does not require a local change. No local `requiresToolsWithToolHistory` workaround was found. Remote proxy compatibility was not tested.
- Read streaming, edit diff/line-ending fixes, symlinked extension dependency resolution, overlay cleanup, and RPC shutdown fixes are relevant upstream improvements. Existing local tests and offline startup passed.
- Pi 1.5.2 adds a fork option for sessions whose original working directory no longer exists. No local `switchSession` calls were found; interactive fork behavior was not manually tested.
- Pi 1.5.1 changes the default `cacheWarming` behavior from `streaming` to `idle`, potentially making paid cache-refresh requests between runs. No user setting was changed. Explicitly setting `cacheWarming` to `streaming` restores the previous behavior.

npm replaced `grok-mermaid` with `lovely-mermaid`, as required by upstream. Planning and usage lockfiles also received compatible transitive updates, including AWS SDK packages, Smithy, Babel runtime, standardwebhooks, and ws. No unrelated direct dependency versions were changed.

The legacy Gemini patch scripts still target a provider path that does not exist in the current installation. They were not used or modified; the dedicated Gemini extension passed its tests.

## Verification

- Baseline root editor tests, TypeScript, and ESLint passed before upgrading, with four existing ESLint warnings.
- All 171 tests passed after upgrading: editor 29, Gemini CLI 19, Codex Work 5, permission gate 64, planning 48, usage 4, Vertex Anthropic 1, and Vertex MaaS 1.
- Root and all seven extension TypeScript checks passed.
- ESLint passed with the same four warnings, including the unrelated unused `listTodosSync` function. Unrelated code was not removed.
- Local and global CLI version checks returned 1.5.2.
- Local and global RPC startup checks used the actual global extension/package configuration, `--offline`, `--no-session`, and temporary working directories.
- Both RPC checks passed with 46 commands, no duplicate command names, zero extension errors, empty stderr, and exit code 0. Terra was present in both `openai-codex` and `openai-codex-work`.
- Temporary smoke working directories were removed.

No live provider requests, billable inference, token-refresh checks, interactive visual TUI checks, or security audit were performed. Offline startup does not verify remote provider availability.

## Rollback

A private snapshot of configuration files and extension symlinks was saved outside the repository:

`~/.local/state/pi-backups/pi-1.5.0-before-1.5.2-20261118T092402Z`

The snapshot directory has mode 700 and configuration copies have mode 600. Installed packages and session history are excluded.

To reinstall the previous global runtime:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0
```

Existing running Pi processes keep their loaded runtime. Start a fresh Pi process to use 1.5.2; `/reload` alone does not upgrade the running host.
