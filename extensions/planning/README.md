# Planning

Commands for turning conversations into implementation plans and managing saved plans.

## Features

- **Command**: `/plan:save` - creates a structured plan from the current conversation
- **Command**: `/plan:list` - lists saved plans with options to execute or edit; archiving is available from the picker UI
- **Command**: `/plan:execute [slug]` - executes a plan directly (selector if no slug)

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
