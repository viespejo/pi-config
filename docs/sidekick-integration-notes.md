# Sidekick PI Integration Notes

## Purpose

This document records the PLAN-01 Task 3 integration done in the user Neovim config, which is outside this repository and therefore cannot be committed directly here.

## External Files Updated

- `/home/its32ve1/.config/nvim/lua/plugins/sidekick.lua`
- `/home/its32ve1/.config/nvim/lua/config/autocommands.lua`

## Change Applied

A PI-scoped environment injection is configured under `cli.tools.pi.env`:

- `EDITOR = "/home/its32ve1/code/pi-config/scripts/pi-editor-context"`
- `VISUAL = "/home/its32ve1/code/pi-config/scripts/pi-editor-context"`
- `PI_EDITOR_OWNER_PANE = vim.env.TMUX_PANE or ""`
- `PI_EDITOR_OWNER_KEY = tostring(vim.g.pi_editor_owner_key or "")`
- `PI_EDITOR_OPEN_MODE = "nvr"`

A concise English comment clarifies this env scope is PI-only.

In addition, Neovim now publishes its RPC server address to two deterministic targets:

- tmux pane-local option: `@pi_editor_nvr_server`
- owner-key state file: `~/.local/state/pi-editor/servers/<sha256(ownerKey)>.json`

Publish timing: startup best-effort, `VimEnter`, `FocusGained`.
Cleanup timing: `VimLeavePre` with guarded cleanup (only unset/delete when still owned by current `vim.v.servername`).

This keeps multi-pane tmux routing deterministic while also enabling `nvr` resolution outside tmux using owner-key state files.

## Constraints Preserved

- PI command identity was not changed (`cmd = { "pi" }` remains untouched).
- No unrelated keymaps were changed.
- No unrelated mux settings were changed.
- No non-PI tool config was changed.
- No Sidekick upstream source files were modified.

## Validation Performed

Syntax check passed:

```bash
luac -p /home/its32ve1/.config/nvim/lua/plugins/sidekick.lua
```

Result: `OK`

## Operational Note

Because this change is outside repo scope, rollback must be done directly in the external file.
