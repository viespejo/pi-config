---
phase: 03-pi-1-0-2
plan: 02
type: execute
wave: 2
depends_on:
  - 03-pi-1-0-2-01
files_modified:
  - /home/its32ve1/.pi/agent/settings.json
  - /home/its32ve1/.pi/agent/extensions/
  - /home/its32ve1/.pi/agent/packages/
  - global Pi installation
runtime_changes:
  - disable or retain configured third-party packages based on audit results
  - upgrade global Pi from 0.85.1 to 1.0.2
  - validate and, if necessary, restore the 0.85.1 rollback snapshot
autonomous: false
---

<objective>
## Goal
Upgrade the installed Pi from 0.85.1 to 1.0.2 only after retained local extensions and configured third-party packages have passed compatibility gates.

## Purpose
Complete live provider verification, protect user state, choose the supported installation route, perform a controlled upgrade, and prove that the real configuration is operational with a tested rollback path.

## Output
- Third-party package compatibility decision for every configured package.
- Successful controlled live checks for custom providers.
- Backups of settings, models, auth metadata, extension links, and package declarations without exposing secrets.
- Pi 1.0.2 installed through an explicitly approved method.
- Post-upgrade smoke-test report or completed rollback to 0.85.1.
</objective>

<context>
Prerequisite:
- `docs/plans/03-pi-1-0-2-01-stabilization-summary.md` must report every acceptance criterion as passed.

Configured third-party packages at planning time:
- `npm:@codexstar/pi-listen`
- `npm:pi-mermaid`
- `npm:pi-extension-manager`
- `npm:pi-resource-center`

Configured primary provider at planning time:
- `openai-codex-work`

Locked decisions:
- Never use `pi update --all` for this migration.
- Do not print or copy credential values into logs, summaries, or the repository.
- Any incompatible optional package must be disabled before the core upgrade or the upgrade must stop.
- Review and DCP must remain retired.
- The user must approve the installation method and the final upgrade command.
</context>

<acceptance_criteria>
## AC-1: Third-party packages have explicit compatibility decisions
Given every configured package
When tested under isolated Pi 1.0.2
Then each package is marked pass, disabled for upgrade, or blocking with a documented reason.

## AC-2: Custom providers pass controlled live verification
Given valid existing credentials
When a minimal request is made to each retained custom provider
Then text streaming, usage, cancellation, and authentication succeed without logging secrets.

## AC-3: Rollback state is complete
Given the current 0.85.1 installation and user configuration
When the upgrade begins
Then a timestamped backup and exact rollback commands exist and have been inspected.

## AC-4: Upgrade method is explicitly approved
Given npm and managed pi.dev installation options
When release guidance and current installation constraints are reviewed
Then the user selects one method before any global installation changes occur.

## AC-5: Pi 1.0.2 passes real-configuration smoke tests
Given the upgraded runtime
When Pi starts with the real retained extensions and approved packages
Then commands, tools, providers, TUI modes, and representative workflows operate without load errors or duplicate modules.

## AC-6: Failure triggers rollback
Given any blocking post-upgrade failure
When it cannot be corrected immediately without risky state changes
Then Pi 0.85.1 and the saved configuration are restored and verified.
</acceptance_criteria>

<tasks>
<task type="auto">
  <name>Audit configured third-party packages in isolation</name>
  <files>Temporary audit trees and `03-pi-1-0-2-02-upgrade-summary.md` only</files>
  <action>
    1. Resolve installed versions and package manifests without updating them.
    2. Inspect host-package dependencies for duplicate Pi module roots.
    3. Load each package individually under Pi 1.0.2 with empty auth/session state.
    4. Run package tests when available and safe.
    5. Load all passing packages together with retained local extensions.
    6. Record each package as `pass`, `disable for upgrade`, or `block`.
    7. Do not execute package-specific network or audio actions unless separately approved.
  </action>
  <verify>AC-1 matrix exists with startup logs and dependency evidence</verify>
  <done>AC-1 satisfied</done>
</task>

<task type="manual">
  <name>Run minimal live custom-provider checks</name>
  <files>No credential or session files committed</files>
  <action>
    With explicit user approval and existing credentials, run one minimal controlled request for:
    1. Gemini CLI: system prompt, one tool declaration, text response, usage, and cancellation.
    2. Vertex Anthropic: text response, thinking level, headers/cache behavior, usage, and cancellation.
    3. Vertex MaaS: text response, auth token resolution, one tool declaration, usage, and cancellation.
    4. Codex Work: OAuth refresh if required and one minimal response.
    Redact tokens, authorization headers, project-sensitive values, and complete provider payloads from logs.
  </action>
  <verify>Each provider is marked pass or blocking; no secret value appears in generated logs</verify>
  <done>AC-2 satisfied</done>
</task>

<task type="manual">
  <name>Create and inspect rollback snapshot</name>
  <files>Timestamped private backup outside the repository</files>
  <action>
    1. Record Node, npm, Pi, and package versions.
    2. Back up `~/.pi/agent/settings.json`, `models.json`, auth storage, extension symlink inventory, package declarations, and relevant managed-package metadata to a permission-restricted directory.
    3. Record the exact command to reinstall `@earendil-works/pi-coding-agent@0.85.1` if npm remains the selected route.
    4. Record restoration commands for configuration and symlinks.
    5. Verify backup readability and permissions without printing secret contents.
  </action>
  <verify>Backup exists, permissions are restricted, and rollback commands have been reviewed</verify>
  <done>AC-3 satisfied</done>
</task>

<task type="manual-decision">
  <name>Select the installation route</name>
  <files>Upgrade summary decision record</files>
  <action>
    1. Compare the managed pi.dev installer recommended by Pi 1.0.1+ with a pinned global npm installation.
    2. Account for executable paths, shell integration, package storage, and rollback behavior.
    3. Present the exact proposed command without executing it.
    4. Obtain explicit user approval for one route.
  </action>
  <verify>The approved route and exact command are recorded</verify>
  <done>AC-4 satisfied</done>
</task>

<task type="manual-confirmed">
  <name>Disable incompatible optional packages and upgrade Pi</name>
  <files>/home/its32ve1/.pi/agent/settings.json, global Pi installation</files>
  <action>
    1. Disable only packages classified `disable for upgrade`; preserve a record for later re-enablement.
    2. Confirm `review.ts` and DCP are not discoverable.
    3. Execute only the approved pinned core-upgrade command.
    4. Do not run `pi update --all`.
    5. Confirm `pi --version` reports 1.0.2 and executable resolution points to the expected installation.
  </action>
  <verify>`command -v pi`, `pi --version`, and package-manager inventory match the approved route</verify>
  <done>Core upgrade completed under AC-4 constraints</done>
</task>

<task type="manual">
  <name>Run post-upgrade real-configuration smoke tests</name>
  <files>Upgrade summary and private diagnostic logs only</files>
  <action>
    1. Start Pi in regular and fullscreen modes.
    2. Verify retained commands, tools, providers, and active-tool defaults.
    3. Exercise Permission Gate, Planning, Todo, Usage, Files, Context, Answer, prompt sync, and provider doctor paths at least once where safe.
    4. Confirm `codemode`, `tool_search`, and MCP built-ins do not collide with local tools.
    5. Repeat minimal provider requests.
    6. Inspect startup diagnostics for duplicate module roots, extension warnings, and resource collisions.
    7. Verify Review and DCP remain absent.
  </action>
  <verify>All required workflows pass and no blocking startup diagnostic remains</verify>
  <done>AC-5 satisfied</done>
</task>

<task type="manual-confirmed">
  <name>Rollback on blocking failure or finalize the upgrade</name>
  <files>Global Pi installation and saved user configuration</files>
  <action>
    If a blocking failure remains:
    1. Stop active Pi processes.
    2. Execute the recorded 0.85.1 rollback command.
    3. Restore configuration and extension links from the snapshot.
    4. Verify `pi --version` and baseline startup.

    If all checks pass:
    1. Keep the rollback snapshot for an agreed retention period.
    2. Record disabled optional packages and follow-up actions.
    3. Finalize the upgrade summary.
  </action>
  <verify>Either Pi 1.0.2 passes AC-5 or Pi 0.85.1 is restored and verified</verify>
  <done>AC-6 satisfied when applicable; migration has a definitive safe outcome</done>
</task>
</tasks>

<boundaries>
## DO NOT CHANGE
- Do not expose credential values in logs or summaries.
- Do not bulk-update user packages.
- Do not re-enable Review or DCP.
- Do not make unrelated source refactors during the live upgrade.

## STOP CONDITIONS
Stop before upgrading if:
- Plan 01 has any failed acceptance criterion.
- A required third-party package is blocking and has no approved disablement.
- Any retained provider fails its controlled live check.
- The rollback snapshot or command is incomplete.
- The user has not approved the exact installation command.
</boundaries>

<verification>
1. Third-party package compatibility matrix.
2. Redacted live-provider results.
3. Backup path, permissions, and rollback command verification.
4. Explicit installation-route approval.
5. `command -v pi` and `pi --version` after upgrade.
6. Real-configuration RPC, regular TUI, and fullscreen TUI startup.
7. Retained command/tool/provider inventory.
8. Representative extension workflow smoke tests.
9. Final rollback-or-success decision.
</verification>

<success_criteria>
- Every configured package has a compatibility disposition.
- Every retained custom provider passes a controlled live check.
- A usable private rollback snapshot exists.
- Pi 1.0.2 was installed only after explicit approval.
- Real configuration and retained extensions pass smoke tests.
- On failure, 0.85.1 is restored successfully.
</success_criteria>

<output>
Produce `docs/plans/03-pi-1-0-2-02-upgrade-summary.md` with:
- third-party package matrix;
- redacted provider check results;
- backup and rollback verification (paths and metadata only, no secrets);
- approved installation route and command;
- post-upgrade version and executable path;
- smoke-test results;
- disabled packages and follow-up work;
- final state: successful 1.0.2 upgrade or verified 0.85.1 rollback.
</output>
