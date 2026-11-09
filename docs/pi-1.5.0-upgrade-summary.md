# Pi 1.5.0 Upgrade Summary

## Result

Upgraded local development dependencies and the NVM-managed global Pi installation from 1.4.0 to 1.5.0. Third-party Pi packages were not updated.

Global installation command:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0
```

## Compatibility review

Reviewed the 1.5.0 release notes and installed extension API documentation. The relevant breaking change moves tool argument validation to `@earendil-works/pi-schema`. Local tools do not use the TypeBox refinements, codecs, custom formats, or non-JSON types affected by this change.

One compile-time compatibility adjustment was required in `extensions/todo.ts`: wrap `StringEnum` in `Type.Unsafe<TodoAction>` to preserve TypeBox inference when compiling against the published pi-ai package. The runtime JSON Schema and allowed actions remain unchanged.

The baseline root typecheck already failed on 1.4.0 in the Codex Work model tests. Added an explicit model fixture type and narrowed the chat/image model union before accessing `contextWindow`.

All eight package manifests now pin their existing Pi development dependencies to 1.5.0. Peer dependency declarations remain unchanged. npm regenerated their lockfiles, including compatible transitive dependency updates, particularly in planning and usage.

## GPT-6.1 Terra

Terra was already supported through the persisted Codex catalog (`models-store.json`), which the Work extension merges with Pi's built-in catalog. Existing tests explicitly cover cloning Terra metadata and accepting future model IDs without hardcoding them.

Pi 1.5.0 adds Terra to its built-in catalog. Both local and global RPC checks confirmed `gpt-6.1-terra` in `openai-codex` and `openai-codex-work`, each with a 500,000-token context window. No manual model entry or provider implementation change was needed.

## Verification

- Root editor tests, TypeScript typecheck, and ESLint.
- Tests and typechecks for Gemini CLI, Codex Work, permission gate, planning, usage, Vertex Anthropic, and Vertex MaaS.
- Direct validation of the loaded todo tool with Pi 1.5.0's argument validator: all nine actions accepted; missing/invalid actions rejected; scalar-to-array and string-to-boolean coercion confirmed.
- Local and global RPC startup using the actual global extension/package configuration, an ephemeral session, a temporary working directory, and `--offline`.
- Each RPC check passed with 46 commands, no duplicate command names, zero extension errors, and Terra present in both Codex providers.
- Temporary smoke working directories were removed.

No live provider requests, billable inference, or interactive visual TUI checks were performed. Offline startup does not verify token refresh or remote provider availability.

ESLint retains four warnings, including the unrelated unused `listTodosSync` function; unrelated code was not removed. npm reported dependency security advisories in the root and some extension development trees. Root `npm audit --omit=dev` reports two moderate advisories in the existing gaxios/uuid dependency chain. No `npm audit fix` was run.

## Rollback

A private snapshot of configuration files and extension symlinks was saved outside the repository:

`~/.local/state/pi-backups/pi-1.4.0-before-1.5.0-20261109T084331Z`

Credential/configuration copies have mode 600 and the snapshot directory has mode 700. The snapshot intentionally excludes installed packages and session history.

To reinstall the previous runtime:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.4.0
```

Existing running Pi processes continue using their loaded runtime. Start a fresh Pi process to use 1.5.0.
