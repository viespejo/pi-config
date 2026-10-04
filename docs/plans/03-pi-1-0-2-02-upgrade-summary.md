# Pi 1.0.2 Controlled Upgrade Summary

## Final status

The controlled upgrade completed successfully.

Global Pi now reports `1.0.2` and resolves through the existing NVM-managed executable path:

- Executable: `/home/its32ve1/.nvm/versions/node/v24.15.0/bin/pi`
- Package: `@earendil-works/pi-coding-agent@1.0.2`
- Previous version: `0.85.1`

No rollback was required.

## Third-party package compatibility

Each configured package was inspected from its published tarball, loaded individually under isolated Pi 1.0.2, and loaded together with all retained local extensions.

| Package | Tested version | Decision | Evidence |
|---|---:|---|---|
| `@codexstar/pi-listen` | 7.2.2 | Pass | Isolated RPC startup passed with no extension errors or duplicate host packages. Combined startup passed. No audio action was invoked. |
| `pi-mermaid` | 0.3.0 | Pass | Isolated RPC startup passed with no extension errors or duplicate host packages. Combined startup passed. No render action was invoked. |
| `pi-extension-manager` | 0.8.2 | Pass, retained disabled | Isolated RPC startup passed despite historical `@mariozechner/*` peer names, with no duplicate host packages. The existing `-src/index.ts` filter intentionally keeps its extension disabled in the real configuration. |
| `pi-resource-center` | 0.3.1 | Pass | Isolated and combined RPC startup passed with no extension errors or duplicate host packages. |

Combined isolated results:

- RPC state query: pass
- Extension errors: 0
- Extension commands: 31
- Duplicate command names: none
- Additional Pi or TypeBox module roots: none
- Retired `/review`, `/end-review`, and `/dcp` commands: absent

No optional package needed to be newly disabled for the upgrade.

## Live provider verification

Live checks used private temporary agent directories, mode-600 copies of `auth.json`, ephemeral sessions, and isolated work directories. Tokens, authorization headers, credential values, and complete provider payloads were not logged.

### Pre-upgrade Pi 1.0.2 verification

- Gemini CLI text and system prompt: pass
- Gemini CLI `read` tool call: pass
- Gemini cancellation before the first token: pass; control returned without an uncaught exception or lingering process
- Vertex Anthropic text response: pass
- Vertex Anthropic `read` tool call: pass
- Vertex MaaS text response: pass
- Vertex MaaS `read` tool call: pass
- Codex Work OAuth and text response: pass
- Google Cloud token retrieval: pass after interactive reauthentication
- Google Cloud location: `global`

### Post-upgrade global-runtime verification

Minimal requests through global Pi 1.0.2 passed for:

- Gemini CLI
- Vertex Anthropic
- Vertex MaaS
- Codex Work

All temporary credential copies, work directories, and environment-state files were deleted after testing.

## Rollback snapshot

A private snapshot was created outside the repository and outside the managed Pi agent directory:

`/home/its32ve1/.local/state/pi-backups/pi-0.85.1-before-1.0.2-20261004T151214Z`

Verified snapshot properties:

- Snapshot and parent directory mode: `700`
- Regular file mode: `600`
- Saved `settings.json`, `models.json`, and `auth.json` match their sources
- Saved npm package declarations and lockfile match their sources
- All 12 extension symlinks are preserved and match the recorded inventory
- Runtime version and executable metadata are recorded
- `ROLLBACK.md` contains runtime reinstall and configuration restoration commands
- Snapshot size at creation: 68 KiB

The snapshot should be retained for seven days after the successful upgrade, then removed with user confirmation.

The pinned runtime rollback command is:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.85.1
```

## Installation decision

The pi.dev installer and pinned npm installation were compared. The user explicitly selected the pinned npm route because it preserves the current NVM path, installs an exact version, avoids executing a downloaded installer script, and provides a direct pinned rollback.

The user explicitly approved this exact command:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.0.2
```

The command completed successfully. `pi update --all` was not run, and optional packages were not bulk-updated.

## Real-configuration smoke tests

The real global configuration passed post-upgrade RPC startup:

- RPC response: pass
- Extension errors: 0
- Duplicate command names: none
- Retained local commands: present
- Active third-party package commands: present
- Intentionally disabled `pi-extension-manager` command: absent as configured
- `/review`, `/end-review`, and `/dcp`: absent
- `/mcp`: present

Interactive verification passed in both modes:

- Regular TUI: pass
- Fullscreen TUI: pass
- Retained extension commands: pass
- Third-party package commands: pass
- Model selector and overlays: pass
- Terminal resize: pass
- Custom global keybindings: pass
- Clean exit: pass
- Duplicate-module or resource-collision warnings: none

An initially missing-command symptom in the user's terminal was traced to a stale `PI_CODING_AGENT_DIR` exported during isolated pre-upgrade testing. Unsetting that environment variable restored the real global configuration immediately. This was an environment isolation artifact, not a Pi or extension regression.

## Cleanup

Removed after verification:

- Isolated package audit trees and downloaded tarballs
- Temporary package-test agents and workspaces
- Temporary provider-test agents and credential copies
- Temporary test logs and environment-state files

Retained intentionally:

- The private rollback snapshot for the agreed seven-day retention period
- Existing workspace changes from the stabilization plan
- Existing user configuration, sessions, and package declarations

## Acceptance criteria

| Acceptance criterion | Status |
|---|---|
| AC-1: Third-party packages have explicit compatibility decisions | Pass |
| AC-2: Custom providers pass controlled live verification | Pass |
| AC-3: Rollback state is complete | Pass |
| AC-4: Upgrade method is explicitly approved | Pass |
| AC-5: Pi 1.0.2 passes real-configuration smoke tests | Pass |
| AC-6: Failure triggers rollback | Not triggered; rollback remains verified and available |

## Final decision

Pi 1.0.2 is accepted as the active global runtime. The real configuration, retained local extensions, configured third-party packages, custom providers, and both TUI modes passed their required checks. Pi 0.85.1 was not restored because no blocking post-upgrade failure remained.
