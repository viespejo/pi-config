# Sidekick PI Integration Notes

## Purpose
This document records the PLAN-01 Task 3 integration done in the user Neovim config, which is outside this repository and therefore cannot be committed directly here.

## External File Updated
- `/home/its32ve1/.config/nvim/lua/plugins/sidekick.lua`

## Change Applied
A PI-scoped environment injection was added under `cli.tools.pi.env`:

- `EDITOR = "/home/its32ve1/code/pi-config/scripts/pi-editor-context"`
- `VISUAL = "/home/its32ve1/code/pi-config/scripts/pi-editor-context"`
- `PI_EDITOR_OPEN_MODE = "nvim"`

A concise English comment was also added to clarify that this env injection is PI-only.

### Why `PI_EDITOR_OPEN_MODE = "nvim"` is set
In this workstation + Sidekick/tmux setup, `auto` mode intermittently falls back in a way that causes a visible startup jump/welcome flash. For stable UX in the PI external editor flow, PI is pinned to `nvim` in Sidekick-scoped env. This does not prevent future `nvr` usage; it is an operational choice for current reliability.

## Constraints Preserved
- PI command identity was not changed (`cmd = { "pi" }` remains untouched).
- No unrelated keymaps were changed.
- No unrelated mux settings were changed.
- No non-PI tool config was changed.

## Validation Performed
Syntax check passed:

```bash
luac -p /home/its32ve1/.config/nvim/lua/plugins/sidekick.lua
```

Result: `OK`

## Operational Note
Because this change is outside repo scope, rollback must be done directly in the external file.
