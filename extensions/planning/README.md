# Planning

Commands for turning conversations into implementation plans and managing saved plans.

## Features

- **Command**: `/plan:save` - creates a structured plan from the current conversation
- **Command**: `/plan:list` - lists saved plans with options to execute or edit; archiving is available from the picker UI
- **Command**: `/plan:execute [slug]` - executes a plan directly (selector if no slug) with per-plan execution log resume safeguards

## Usage

### Creating Plans

Run `/plan:save` to generate a plan from the current conversation. The agent will analyze the discussion and create a structured implementation plan in `.agents/plans/`.

### Managing Plans

Run `/plan:list` to see all saved plans. From there you can:
- **Execute** - Run the plan
- **Edit** - Open the plan in your `$VISUAL/$EDITOR`
- **Archive** - Use `Ctrl+A` in the interactive picker to move the selected plan to the archive directory

## Configuration

Create `~/.pi/agent/extensions/planning.json` to configure plan directories:

```json
{
  "plansDir": ".agents/plans",
  "archiveDir": "/path/to/plan-archive"
}
```

`plansDir` can be relative to the project root or an absolute path.

The `archiveDir` should point to a git repository. When archiving, the extension will:
1. Move the plan file to the archive directory
2. Stage the change
3. Commit with message "Archive plan: <filename>"
4. Push to remote (silently)

If any git operation fails, you'll receive a notification but the plan will still be archived locally.

Config is loaded from the global scope only.

## /plan:execute interaction model

`/plan:execute` follows a strict APPLY workflow:
- approval gate before starting execution
- task-by-task processing in declared order
- per-task menu:
  - `[1] Apply now`
  - `[2] Explain task first`
  - `[3] Show code preview`
  - `[4] Skip`
- mandatory post-apply review after each applied task:
  - `[A] Accept`
  - `[B] amended manually`

## Execute log + resume behavior

`/plan:execute` uses a per-plan JSONL execution log stored next to the plan file:
- `<plansDir>/<slug>.execution.jsonl`

If that file already exists, runtime asks:
- `Execution log detected for this plan. Resume from next pending task? (yes/no)`

If resume is declined, execution is aborted with:
- `Execution aborted. Delete <slug>.execution.jsonl to start from scratch.`

If the log is incoherent/corrupt, execution is blocked until manual correction or deletion.
If the log already closes the final task, runtime reports closure routing instead of dispatching more tasks.
