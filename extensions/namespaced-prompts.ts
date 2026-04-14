/**
 * This extension discovers and registers namespaced prompt templates as executable slash commands.
 * It scans project-local and global directories for Markdown files organized by folder (namespace).
 * Templates support dynamic argument expansion (e.g., $1, $ARGUMENTS, $@) and frontmatter-based
 * descriptions, allowing users to invoke them using the `/namespace:template` syntax.
 */
import type {
  ExtensionAPI,
  SlashCommandInfo,
} from "@mariozechner/pi-coding-agent";
import {
  parseFrontmatter,
  stripFrontmatter,
} from "@mariozechner/pi-coding-agent";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

type TemplateInfo = {
  alias: string;
  namespace: string;
  name: string;
  path: string;
  description?: string;
};

function parseArgs(str: string): string[] {
  if (!str) return [];

  const re = /"([^"]+)"|(\S+)/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = re.exec(str)) !== null) {
    if (match[1] !== undefined) out.push(match[1]);
    else if (match[2] !== undefined) out.push(match[2]);
  }

  return out;
}

function expandTemplate(body: string, args: string[]): string {
  return body
    .replace(/\$(\d+)/g, (_, n) => args[parseInt(n, 10) - 1] ?? "")
    .replace(/\$ARGUMENTS/g, args.join(" "))
    .replace(/\$@/g, args.join(" "))
    .replace(/\$\{\@:(\d+)(?::(\d+))?\}/g, (_, s, l) => {
      const start = Math.max(0, parseInt(s, 10) - 1);
      return l
        ? args.slice(start, start + parseInt(l, 10)).join(" ")
        : args.slice(start).join(" ");
    });
}

function parseTemplateFile(fileContents: string): {
  body: string;
  description?: string;
} {
  try {
    if (typeof parseFrontmatter === "function") {
      const parsed = parseFrontmatter(fileContents) as {
        body?: string;
        frontmatter?: Record<string, unknown>;
      };

      if (typeof parsed?.body === "string") {
        const description =
          typeof parsed.frontmatter?.description === "string"
            ? parsed.frontmatter.description
            : undefined;

        return {
          body: parsed.body,
          description,
        };
      }
    }
  } catch {
    // fallback below
  }

  if (typeof stripFrontmatter === "function") {
    return {
      body: stripFrontmatter(fileContents),
    };
  }

  return {
    body: fileContents,
  };
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function collectPromptRoots(commands: SlashCommandInfo[]): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();

  const add = (value: string) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    roots.push(value);
  };

  // Prefer project-local first
  add(join(process.cwd(), ".pi", "prompts"));

  // Roots already discovered by PI prompt commands (top-level files)
  for (const command of commands) {
    if (command.source !== "prompt") continue;
    add(dirname(command.sourceInfo.path));
  }

  // Then global default
  add(join(homedir(), ".pi", "agent", "prompts"));

  return roots.filter(isDirectory);
}

function discoverNamespacedTemplates(promptRoots: string[]): TemplateInfo[] {
  const byAlias = new Map<string, TemplateInfo>();

  for (const root of promptRoots) {
    const namespaceDirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const namespace of namespaceDirs) {
      const namespacePath = join(root, namespace);
      const templates = readdirSync(namespacePath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name)
        .sort();

      for (const templateFile of templates) {
        const name = templateFile.replace(/\.md$/, "");
        const alias = `${namespace}:${name}`;
        const path = join(namespacePath, templateFile);

        let description: string | undefined;
        try {
          const parsed = parseTemplateFile(readFileSync(path, "utf8"));
          description = parsed.description;
        } catch {
          // ignore parse/read errors at discovery; handled at execution time
        }

        // First root wins (project-local overrides global by ordering)
        if (!byAlias.has(alias)) {
          byAlias.set(alias, { alias, namespace, name, path, description });
        }
      }
    }
  }

  return Array.from(byAlias.values());
}

export default function namespacedPrompts(pi: ExtensionAPI) {
  const registered = new Set<string>();

  const syncCommands = () => {
    const roots = collectPromptRoots(pi.getCommands());
    const templates = discoverNamespacedTemplates(roots);

    for (const template of templates) {
      if (registered.has(template.alias)) continue;
      registered.add(template.alias);

      pi.registerCommand(template.alias, {
        description:
          template.description || `Run prompt template /${template.alias}`,
        handler: async (args, ctx) => {
          let fileContents: string;
          try {
            fileContents = readFileSync(template.path, "utf8");
          } catch {
            if (ctx.hasUI) {
              ctx.ui.notify(
                `Could not read template: ${template.path}`,
                "error",
              );
            }
            return;
          }

          const parsed = parseTemplateFile(fileContents);
          const expanded = expandTemplate(parsed.body, parseArgs(args));

          pi.sendUserMessage(expanded);
        },
      });
    }
  };

  pi.on("session_start", () => {
    syncCommands();
  });

  pi.on("resources_discover", () => {
    syncCommands();
  });

  pi.registerCommand("prompts:sync", {
    description: "Synchronize namespaced prompt template commands",
    handler: async (_args, ctx) => {
      syncCommands();
      if (ctx.hasUI) {
        ctx.ui.notify("Namespaced prompt commands synchronized", "info");
      }
    },
  });
}
