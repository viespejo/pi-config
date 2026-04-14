import fs from "node:fs";
import nodePath from "node:path";
import { homedir } from "node:os";

export type PermissionAction = "allow" | "deny" | "ask" | "default";

export type ParsedRule = {
  tool: string;
  specifier: string | null;
  raw: string;
  sourcePath?: string;
};

export type PermissionConfig = {
  allow: ParsedRule[];
  deny: ParsedRule[];
  ask: ParsedRule[];
};

export type PermissionSource = {
  path: string;
  kind: "global" | "local";
  config: PermissionConfig;
};

export type PermissionState = {
  merged: PermissionConfig;
  sources: PermissionSource[];
  warnings: string[];
  activeSource: "global" | "local" | "none";
};

export type PermissionVerdict = {
  action: PermissionAction;
  matchedRule?: string;
  matchedSegment?: string;
  reason?: string;
};

const EMPTY_CONFIG: PermissionConfig = { allow: [], deny: [], ask: [] };

const stateCache = new Map<string, PermissionState>();

export function normalizeToolName(name: string) {
  const raw = String(name ?? "").trim();
  if (raw.includes("*") || raw.includes("?")) {
    return raw.toLowerCase();
  }

  const lower = raw.toLowerCase();
  const map: Record<string, string> = {
    bash: "bash",
    read: "read",
    write: "write",
    edit: "edit",
    ls: "ls",
    find: "find",
    grep: "grep",
    cd: "cd",
  };

  return map[lower] ?? lower;
}

export function parseRule(raw: string): ParsedRule {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("Invalid permission rule: empty value");
  }

  const trimmed = raw.trim();
  const open = trimmed.indexOf("(");
  if (open === -1) {
    return { tool: normalizeToolName(trimmed), specifier: null, raw: trimmed };
  }

  const close = trimmed.lastIndexOf(")");
  if (close <= open) {
    throw new Error(`Invalid permission rule: malformed parenthesis in \"${trimmed}\"`);
  }

  const tool = trimmed.slice(0, open).trim();
  if (!tool) {
    throw new Error(`Invalid permission rule: missing tool in \"${trimmed}\"`);
  }

  const spec = trimmed.slice(open + 1, close);
  return {
    tool: normalizeToolName(tool),
    specifier: spec.length > 0 ? spec : null,
    raw: trimmed,
  };
}

function parseRules(entries: unknown, warnings: string[], sourcePath: string): ParsedRule[] {
  if (!Array.isArray(entries)) return [];

  const out: ParsedRule[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      warnings.push(`Skipping non-string rule in ${sourcePath}: ${JSON.stringify(entry)}`);
      continue;
    }

    try {
      const parsed = parseRule(entry);
      out.push({ ...parsed, sourcePath });
    } catch (error) {
      warnings.push(String(error));
    }
  }
  return out;
}

function parsePermissionConfig(
  permissionsValue: unknown,
  warnings: string[],
  sourcePath: string,
): PermissionConfig {
  if (permissionsValue == null) return EMPTY_CONFIG;

  if (typeof permissionsValue !== "object") {
    warnings.push(`Invalid permissionGate.permissions in ${sourcePath}: expected object.`);
    return EMPTY_CONFIG;
  }

  const obj = permissionsValue as {
    allow?: unknown;
    deny?: unknown;
    ask?: unknown;
  };

  return {
    allow: parseRules(obj.allow, warnings, sourcePath),
    deny: parseRules(obj.deny, warnings, sourcePath),
    ask: parseRules(obj.ask, warnings, sourcePath),
  };
}

function getPermissionNode(raw: unknown): { exists: boolean; value: unknown } {
  if (!raw || typeof raw !== "object") {
    return { exists: false, value: undefined };
  }

  const root = raw as { permissionGate?: unknown };
  if (!root.permissionGate || typeof root.permissionGate !== "object") {
    return { exists: false, value: undefined };
  }

  const permissionGate = root.permissionGate as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(permissionGate, "permissions")) {
    return { exists: false, value: undefined };
  }

  return { exists: true, value: permissionGate.permissions };
}

function readJsonFile(filePath: string): { exists: boolean; data?: unknown; error?: string } {
  if (!fs.existsSync(filePath)) return { exists: false };

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return { exists: true, data: JSON.parse(raw) };
  } catch {
    return { exists: true, error: `Could not parse settings JSON: ${filePath}` };
  }
}

function computePermissionState(cwd: string): PermissionState {
  const warnings: string[] = [];
  const sources: PermissionSource[] = [];

  const globalPath = nodePath.join(homedir(), ".pi", "settings.json");
  const localPath = nodePath.join(cwd, ".pi", "settings.json");

  const globalRead = readJsonFile(globalPath);
  const localRead = readJsonFile(localPath);

  if (globalRead.error) warnings.push(globalRead.error);
  if (localRead.error) warnings.push(localRead.error);

  const globalNode = globalRead.data ? getPermissionNode(globalRead.data) : { exists: false, value: undefined };
  const localNode = localRead.data ? getPermissionNode(localRead.data) : { exists: false, value: undefined };

  if (localNode.exists) {
    const config = parsePermissionConfig(localNode.value, warnings, localPath);
    sources.push({ path: localPath, kind: "local", config });
    return {
      merged: config,
      sources,
      warnings,
      activeSource: "local",
    };
  }

  if (globalNode.exists) {
    const config = parsePermissionConfig(globalNode.value, warnings, globalPath);
    sources.push({ path: globalPath, kind: "global", config });
    return {
      merged: config,
      sources,
      warnings,
      activeSource: "global",
    };
  }

  return {
    merged: EMPTY_CONFIG,
    sources,
    warnings,
    activeSource: "none",
  };
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "*") {
      out += ".*";
      continue;
    }
    if (char === "?") {
      out += ".";
      continue;
    }
    if ("\\^$.|+()[]{}".includes(char)) {
      out += `\\${char}`;
      continue;
    }
    out += char;
  }
  return new RegExp(`^${out}$`);
}

function splitBashSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escaped = false;

  function pushCurrent() {
    const trimmed = current.trim();
    if (trimmed.length > 0) segments.push(trimmed);
    current = "";
  }

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }

    if (!inDouble && !inBacktick && ch === "'") {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (!inSingle && !inBacktick && ch === '"') {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble && ch === "`") {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }

    const outsideQuotes = !inSingle && !inDouble && !inBacktick;
    if (outsideQuotes) {
      const next = command[i + 1];
      if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
        pushCurrent();
        i++;
        continue;
      }
      if (ch === ";" || ch === "|" || ch === "\n") {
        pushCurrent();
        continue;
      }
    }

    current += ch;
  }

  pushCurrent();
  return segments;
}

function ruleTargetsBash(ruleTool: string): boolean {
  if (ruleTool === "bash") return true;
  if (ruleTool === "*") return true;
  if (ruleTool.includes("*") || ruleTool.includes("?")) {
    return globToRegExp(ruleTool).test("bash");
  }
  return false;
}

function matchRuleAgainstSegments(
  rule: ParsedRule,
  segments: string[],
): { matched: boolean; matchedSegment?: string } {
  if (!ruleTargetsBash(rule.tool)) {
    return { matched: false };
  }

  if (rule.specifier == null) {
    return { matched: true, matchedSegment: segments[0] };
  }

  const matcher = globToRegExp(rule.specifier);
  for (const segment of segments) {
    if (matcher.test(segment)) {
      return { matched: true, matchedSegment: segment };
    }
  }

  return { matched: false };
}

export function clearPermissionStateCache(cwd?: string) {
  if (typeof cwd === "string" && cwd.length > 0) {
    stateCache.delete(nodePath.resolve(cwd));
    return;
  }
  stateCache.clear();
}

export function loadPermissionState(
  cwd: string,
  options?: { reload?: boolean },
): PermissionState {
  const cacheKey = nodePath.resolve(cwd);
  if (!options?.reload && stateCache.has(cacheKey)) {
    return stateCache.get(cacheKey)!;
  }

  const state = computePermissionState(cacheKey);
  stateCache.set(cacheKey, state);
  return state;
}

export function reloadPermissionState(cwd: string): PermissionState {
  return loadPermissionState(cwd, { reload: true });
}

export function evaluatePermission(
  toolName: string,
  input: Record<string, unknown>,
  _cwd: string,
  state: PermissionState,
): PermissionVerdict {
  const tool = normalizeToolName(toolName);
  if (tool !== "bash") {
    return { action: "default", reason: "No config rule evaluation for non-bash tools." };
  }

  const command = typeof input.command === "string" ? input.command : "";
  const segments = splitBashSegments(command);
  if (segments.length === 0) {
    return { action: "default", reason: "No bash command segments found." };
  }

  for (const rule of state.merged.deny) {
    const res = matchRuleAgainstSegments(rule, segments);
    if (res.matched) {
      return {
        action: "deny",
        matchedRule: rule.raw,
        matchedSegment: res.matchedSegment,
        reason: `Denied by configured rule ${rule.raw}`,
      };
    }
  }

  for (const rule of state.merged.ask) {
    const res = matchRuleAgainstSegments(rule, segments);
    if (res.matched) {
      return {
        action: "ask",
        matchedRule: rule.raw,
        matchedSegment: res.matchedSegment,
        reason: `Confirmation required by configured rule ${rule.raw}`,
      };
    }
  }

  for (const rule of state.merged.allow) {
    const res = matchRuleAgainstSegments(rule, segments);
    if (res.matched) {
      return {
        action: "allow",
        matchedRule: rule.raw,
        matchedSegment: res.matchedSegment,
        reason: `Allowed by configured rule ${rule.raw}`,
      };
    }
  }

  return { action: "default", reason: "No matching bash rule." };
}

export function parseTestExpression(ruleText: string): {
  toolName: string;
  input: Record<string, unknown>;
} {
  const trimmed = ruleText.trim();
  const open = trimmed.indexOf("(");
  const close = trimmed.lastIndexOf(")");

  let tool = trimmed;
  let specifier = "";

  if (open !== -1 && close > open) {
    tool = trimmed.slice(0, open);
    specifier = trimmed.slice(open + 1, close);
  }

  const normalizedTool = normalizeToolName(tool);
  const input: Record<string, unknown> = {};

  if (normalizedTool === "bash") {
    input.command = specifier;
  }

  return { toolName: normalizedTool, input };
}

export function totalRuleCount(state: PermissionState) {
  return state.merged.allow.length + state.merged.deny.length + state.merged.ask.length;
}

export function getBashSegments(command: string) {
  return splitBashSegments(command);
}
