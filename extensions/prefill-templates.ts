import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  parseFrontmatter,
  stripFrontmatter,
} from "@mariozechner/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(str: string): string[] {
  if (!str) return [];
  const re = /"([^"]+)"|(\S+)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(m[2]);
  }
  return out;
}

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    if (!event.text) return { action: "continue" };
    if (event.source !== "interactive") return { action: "continue" };

    const raw = event.text.trim();
    if (!raw.startsWith("?")) return { action: "continue" };

    const token = raw.split(/\s+/)[0].slice(1); // "?name" -> "name"
    const commands = pi.getCommands();
    const matching = commands.find(
      (c) => c.name === token && c.source === "prompt",
    );
    if (!matching) return { action: "continue" };

    // read template file (try absolute then relative to cwd)
    const templatePath = matching.sourceInfo.path;
    let fileContents: string;
    try {
      fileContents = readFileSync(templatePath, "utf-8");
    } catch {
      try {
        fileContents = readFileSync(
          join(ctx.cwd ?? process.cwd(), templatePath),
          "utf-8",
        );
      } catch (err) {
        if (ctx.hasUI)
          ctx.ui.notify(`Could not read template: ${String(err)}`, "error");
        return { action: "continue" };
      }
    }

    // get body using parseFrontmatter/stripFrontmatter (public exports)
    let body = fileContents;
    try {
      if (typeof parseFrontmatter === "function") {
        const p = parseFrontmatter(fileContents as string);
        body = p?.body ?? fileContents;
      } else if (typeof stripFrontmatter === "function") {
        body = stripFrontmatter(fileContents as string);
      }
    } catch {
      // fallback to raw file body if parsing fails
      body = fileContents;
    }

    // Very small fallback: naive positional substitution ($1, $@, ${@:N})
    const args =
      raw.indexOf(" ") === -1 ? [] : parseArgs(raw.slice(raw.indexOf(" ") + 1));
    const expanded = body
      .replace(/\$(\d+)/g, (_, n) => args[parseInt(n, 10) - 1] ?? "")
      .replace(/\$ARGUMENTS/g, args.join(" "))
      .replace(/\$@/g, args.join(" "))
      .replace(/\$\{\@:(\d+)(?::(\d+))?\}/g, (_, s, l) => {
        const start = Math.max(0, parseInt(s, 10) - 1);
        return l
          ? args.slice(start, start + parseInt(l, 10)).join(" ")
          : args.slice(start).join(" ");
      });

    if (!ctx.hasUI) {
      // No UI: transform input to expanded text (non-interactive hosts)
      return { action: "transform", text: expanded };
    }

    ctx.ui.setEditorText(expanded);
    ctx.ui.notify(
      "Template inserted into editor. Review and press Enter to send.",
      "info",
    );
    return { action: "handled" };
  });
}
