import nodePath from "node:path";

export type BashAssessment = {
  hardDenyReason?: string;
  highRisk: boolean;
  highRiskReasons: string[];
};

const HARD_DENY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+-rf\s+\/(\s|$)/i,
    reason: "Detected destructive root deletion (rm -rf /).",
  },
  {
    pattern: /\bmkfs(\.[a-z0-9_+-]+)?\b/i,
    reason: "Detected filesystem formatting command (mkfs).",
  },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: "Detected fork bomb pattern.",
  },
  {
    pattern: /\b(shutdown|reboot|poweroff|halt)\b/i,
    reason: "Detected system power operation command.",
  },
  {
    pattern: /\bdd\s+if=\S+\s+of=\/dev\/(sd[a-z]\d*|nvme\d+n\d+(p\d+)?)/i,
    reason: "Detected raw disk write via dd to /dev device.",
  },
];

const HIGH_RISK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|\s)sudo(\s|$)/i, reason: "Uses sudo." },
  {
    pattern: /curl\b[^\n|]*\|\s*(bash|sh|zsh)\b/i,
    reason: "Pipes curl output to a shell.",
  },
  {
    pattern: /wget\b[^\n|]*\|\s*(bash|sh|zsh)\b/i,
    reason: "Pipes wget output to a shell.",
  },
  { pattern: /\bchmod\s+-R\s+777\b/i, reason: "Uses chmod -R 777." },
  { pattern: /\bchown\s+-R\s+root\b/i, reason: "Uses chown -R root." },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "Uses git reset --hard." },
  {
    pattern: /\bgit\s+clean\s+-f[a-z]*\b/i,
    reason: "Uses forceful git clean.",
  },
  { pattern: /\bdd\s+if=\S+/i, reason: "Uses dd with explicit input." },
];

const INTERPRETER_NAMES = new Set([
  "bash",
  "sh",
  "zsh",
  "fish",
  "python",
  "python3",
  "node",
  "deno",
  "ruby",
  "perl",
  "php",
  "pwsh",
  "powershell",
]);

const SCRIPT_EXTENSIONS = [
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".rb",
  ".pl",
  ".php",
];

function tokenizeShellLike(input: string) {
  const matches = input.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g);
  return matches ?? [];
}

function unquote(token: string) {
  const trimmed = token.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizePathToken(token: string, cwd: string) {
  if (!token || token.startsWith("-") || token.includes("://"))
    return undefined;
  if (
    token.includes("*") ||
    token.includes("?") ||
    token.includes("$") ||
    token.includes("{")
  ) {
    return undefined;
  }

  if (token.startsWith("~/"))
    return nodePath.resolve(process.env.HOME ?? "~", token.slice(2));
  if (nodePath.isAbsolute(token)) return nodePath.normalize(token);
  if (token.startsWith("./") || token.startsWith("../"))
    return nodePath.resolve(cwd, token);
  return undefined;
}

function isOutsideCwd(targetPath: string, cwd: string) {
  const rel = nodePath.relative(cwd, targetPath);
  return rel.startsWith("..") || nodePath.isAbsolute(rel);
}

function isScriptPath(token: string) {
  const lower = token.toLowerCase();
  return SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function classifyBashRisk(command: string, cwd: string): BashAssessment {
  for (const { pattern, reason } of HARD_DENY_PATTERNS) {
    if (pattern.test(command)) {
      return {
        hardDenyReason: reason,
        highRisk: true,
        highRiskReasons: [reason],
      };
    }
  }

  const reasons = new Set<string>();

  for (const { pattern, reason } of HIGH_RISK_PATTERNS) {
    if (pattern.test(command)) reasons.add(reason);
  }

  const segments = command
    .split(/(?:&&|\|\||;|\||\n)/g)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const tokens = tokenizeShellLike(segment).map(unquote).filter(Boolean);
    if (tokens.length === 0) continue;

    const cmd = tokens[0]!.toLowerCase();
    if (cmd === "npm" || cmd === "pnpm" || cmd === "yarn" || cmd === "bun") {
      if (tokens.includes("run")) reasons.add(`Uses script runner: ${cmd} run`);
    }
    if (cmd === "make" || cmd === "just") {
      reasons.add(`Uses task runner: ${cmd}`);
    }

    if (INTERPRETER_NAMES.has(cmd) && tokens[1] && isScriptPath(tokens[1]!)) {
      reasons.add(`Executes script via interpreter (${cmd} ${tokens[1]}).`);
    }

    if (isScriptPath(cmd) || cmd.startsWith("./") || cmd.startsWith("../")) {
      reasons.add(`Executes script directly (${tokens[0]}).`);
    }

    for (const tok of tokens) {
      const resolved = normalizePathToken(tok, cwd);
      if (!resolved) continue;
      if (isOutsideCwd(resolved, cwd)) {
        reasons.add(`Targets a path outside cwd (${tok}).`);
      }
    }
  }

  return {
    highRisk: reasons.size > 0,
    highRiskReasons: [...reasons],
  };
}
