import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const INIT_PROMPT = `Please analyze this codebase and create an AGENTS.md file for AI coding agent sessions.

## Core principle

Only document what an agent can't quickly discover on its own in a fresh session. The further something is from immediate access — reading a file, running a command, following an import — the more it belongs here. If it's one command away, leave it out.

## What belongs (high discovery cost)

- Commands with non-obvious flags, ordering constraints, or gotchas ("must build X before Y", "use bun test not npm test", "single test requires this flag")
- Implicit constraints not enforced by tooling or visible in code ("don't fork X", "always rebase merge", "this directory is generated — don't edit")
- Architectural decisions that require reading many files to piece together
- Conventions that fail silently or cause subtle bugs when violated
- Non-standard project setup (unusual monorepo wiring, forked dependencies, vendored packages)

## What does NOT belong (low discovery cost)

- Tech stack — obvious from package.json, Cargo.toml, pyproject.toml, etc.
- File and directory structure — agents can ls and find
- Per-file descriptions — agents can read files
- Standard framework patterns the agent knows from training data
- Information already in README.md (the agent reads it)
- Generic practices ("write tests", "use descriptive names", "handle errors")
- Fabricated sections like "Tips for Development" or "Support" unless they exist in the repo

## Additional sources to check

- Cursor rules (.cursor/rules/ or .cursorrules), Copilot rules (.github/copilot-instructions.md) — incorporate the non-obvious parts only.
- If there's an existing AGENTS.md or CLAUDE.md, evaluate it against this principle — trim what's discoverable, add what's hidden.

## Format

Prefix the file with:

# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

Be terse. Every line should save an agent real discovery time or prevent a silent mistake. If a fact takes one command to find, it doesn't need a line.`;

const MIGRATE_PROMPT = `There is an existing CLAUDE.md in this project that should be migrated to AGENTS.md.

1. Read the existing CLAUDE.md file.
2. Create a new AGENTS.md, but don't copy it verbatim. Evaluate each item against discovery cost:
   - Keep: implicit constraints, build ordering gotchas, architectural decisions spanning many files, conventions that fail silently if violated.
   - Cut: tech stack identification, file/directory listings, per-file descriptions, standard patterns, anything an agent finds with one command (ls, cat package.json, reading a config file).
3. Replace agent-specific references with generic agent-neutral language.
4. Use header "# AGENTS.md" and description: "This file provides guidance to AI coding agents when working with code in this repository."

The goal is a lean file. Every line should represent something that would cost an agent real time to discover or that it might get wrong without being told.`;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "coverage",
  ".turbo",
  ".cache",
  ".output",
]);

function findNestedClaudeMdFiles(cwd: string, maxDepth = 5): string[] {
  const results: string[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const name = entry.name;
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;

      const subdir = path.join(dir, name);
      const claudeMdPath = path.join(subdir, "CLAUDE.md");

      try {
        if (fs.existsSync(claudeMdPath) && fs.statSync(claudeMdPath).isFile()) {
          results.push(claudeMdPath);
        }
      } catch {
        // Ignore filesystem errors
      }

      walk(subdir, depth + 1);
    }
  }

  walk(cwd, 0);
  return results;
}

function buildMigratePrompt(options: { filesToRemove: string[]; nestedFiles: string[] }): string {
  const { filesToRemove, nestedFiles } = options;
  if (filesToRemove.length === 0 && nestedFiles.length === 0) return MIGRATE_PROMPT;

  const lines: string[] = [MIGRATE_PROMPT];

  if (nestedFiles.length > 0) {
    lines.push(
      "",
      "In addition, there are CLAUDE.md files in subdirectories that should be migrated:",
      ...nestedFiles.map((file) => `- ${file}`),
      "",
      "For each of these files, create a sibling AGENTS.md file in the same directory.",
    );
  }

  if (filesToRemove.length > 0) {
    lines.push(
      "",
      "After creating AGENTS.md files, delete the following obsolete CLAUDE.md files:",
      ...filesToRemove.map((file) => `- ${file}`),
    );
  }

  return lines.join("\n");
}

export default function init(pi: ExtensionAPI) {
  pi.registerCommand("init", {
    description: "Initialize or migrate AGENTS.md for the current project",
    handler: async (_args, ctx) => {
      const cwd = ctx.cwd;
      const claudeMdPath = path.join(cwd, "CLAUDE.md");
      const agentsMdPath = path.join(cwd, "AGENTS.md");

      const claudeExists = fs.existsSync(claudeMdPath);
      const agentsExists = fs.existsSync(agentsMdPath);
      const nestedClaudeMdFiles = findNestedClaudeMdFiles(cwd);

      const allClaudeMdFiles: string[] = [];
      if (claudeExists) allClaudeMdFiles.push(claudeMdPath);
      allClaudeMdFiles.push(...nestedClaudeMdFiles);

      if (agentsExists && allClaudeMdFiles.length > 0) {
        const fileList = allClaudeMdFiles.map((f) => `- ${path.relative(cwd, f)}`).join("\n");
        ctx.ui.notify(
          `AGENTS.md already exists. Found legacy CLAUDE.md files that were not migrated:\n${fileList}`,
          "warning",
        );
      }

      let removeClaudeMd = false;
      if (allClaudeMdFiles.length > 0 && !agentsExists) {
        const fileList = allClaudeMdFiles.map((f) => `  ${path.relative(cwd, f)}`).join("\n");
        removeClaudeMd = await ctx.ui.confirm(
          "Remove CLAUDE.md files after migration?",
          `Found CLAUDE.md files:\n${fileList}\n\nThey will be migrated to AGENTS.md first.`,
        );
      }

      if (agentsExists) {
        ctx.ui.notify("Improving existing AGENTS.md...", "info");
        pi.sendUserMessage(INIT_PROMPT);
      } else if (allClaudeMdFiles.length > 0) {
        ctx.ui.notify("Migrating CLAUDE.md to AGENTS.md...", "info");
        const prompt = buildMigratePrompt({
          filesToRemove: removeClaudeMd ? allClaudeMdFiles.map((f) => path.relative(cwd, f)) : [],
          nestedFiles: nestedClaudeMdFiles.map((f) => path.relative(cwd, f)),
        });
        pi.sendUserMessage(prompt);
      } else {
        ctx.ui.notify("Creating new AGENTS.md...", "info");
        pi.sendUserMessage(INIT_PROMPT);
      }
    },
  });
}
