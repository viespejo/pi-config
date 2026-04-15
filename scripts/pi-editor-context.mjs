#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MARKERS = {
  contextStart: "<!-- PI_CONTEXT_START -->",
  contextEnd: "<!-- PI_CONTEXT_END -->",
  promptStart: "<!-- PI_PROMPT_START -->",
};

const DEFAULTS = {
  enabled: true,
  messages: 12,
  sessionFile: "",
  includeAssistant: true,
  maxChars: 12000,
  maxPerMessage: 2000,
  maxAgeDays: 0,
  showTime: false,
  openMode: "auto",
  nvrWaitMode: "buffer",
  workingMode: "temp",
  emptyPolicy: "allow",
  errorPolicy: "soft",
  debug: false,
  sessionsDir: "",
};

const CONFIG_KEYS = Object.keys(DEFAULTS);

function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeEol(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function trimSingleTrailingNewline(text) {
  if (!text) return "";
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function stripAnsiAndControl(text) {
  const noAnsi = text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
  return noAnsi.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
    "",
  );
}

function truncate(text, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return "";
  if (text.length <= limit) return text;
  if (limit <= 1) return "…";
  return `${text.slice(0, limit - 1)}…`;
}

function resolveCwd(env) {
  return env.PI_EDITOR_CWD_HINT || env.PWD || process.cwd();
}

function cwdToBucket(cwdPath) {
  const compact = cwdPath
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `--${compact || "root"}--`;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(targetPath) {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pickOpenMode(mode) {
  return ["auto", "nvr", "nvim"].includes(mode) ? mode : "auto";
}

function pickWaitMode(mode) {
  return ["buffer", "tab"].includes(mode) ? mode : "buffer";
}

function pickWorkingMode(mode) {
  return ["temp", "persistent"].includes(mode) ? mode : "temp";
}

function pickEmptyPolicy(policy) {
  return ["allow", "restore"].includes(policy) ? policy : "allow";
}

function pickErrorPolicy(policy) {
  return ["soft", "hard"].includes(policy) ? policy : "soft";
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

async function resolveConfigDetailed(env, cwd, overrides = {}) {
  const userConfigPath =
    overrides.userConfigPath ??
    path.join(os.homedir(), ".config", "pi-editor-context", "config.json");
  const projectConfigPath =
    overrides.projectConfigPath ?? path.join(cwd, ".pi", "editor-context.json");

  const [userConfig, projectConfig] = await Promise.all([
    readJsonSafe(userConfigPath),
    readJsonSafe(projectConfigPath),
  ]);

  const userLayer =
    userConfig && typeof userConfig === "object" ? userConfig : {};
  const projectLayer =
    projectConfig && typeof projectConfig === "object" ? projectConfig : {};

  const envConfig = {
    enabled: toBool(env.PI_EDITOR_CONTEXT_ENABLED, undefined),
    messages: toInt(env.PI_EDITOR_CONTEXT_MESSAGES, undefined),
    sessionFile: env.PI_EDITOR_CONTEXT_SESSION_FILE,
    includeAssistant: toBool(
      env.PI_EDITOR_CONTEXT_INCLUDE_ASSISTANT,
      undefined,
    ),
    maxChars: toInt(env.PI_EDITOR_CONTEXT_MAX_CHARS, undefined),
    maxPerMessage: toInt(env.PI_EDITOR_CONTEXT_MAX_PER_MESSAGE, undefined),
    maxAgeDays: toInt(env.PI_EDITOR_CONTEXT_MAX_AGE_DAYS, undefined),
    showTime: toBool(env.PI_EDITOR_CONTEXT_SHOW_TIME, undefined),
    openMode: env.PI_EDITOR_OPEN_MODE,
    nvrWaitMode: env.PI_EDITOR_NVR_WAIT_MODE,
    workingMode: env.PI_EDITOR_WORKING_MODE,
    emptyPolicy: env.PI_EDITOR_EMPTY_POLICY,
    errorPolicy: env.PI_EDITOR_ERROR_POLICY,
    debug: toBool(env.PI_EDITOR_DEBUG, undefined),
    sessionsDir: env.PI_EDITOR_SESSIONS_DIR,
  };

  const envLayer = Object.fromEntries(
    Object.entries(envConfig).filter(([, value]) => value !== undefined),
  );

  const merged = {
    ...DEFAULTS,
    ...userLayer,
    ...projectLayer,
    ...envLayer,
  };

  merged.messages = Math.max(1, toInt(merged.messages, DEFAULTS.messages));
  merged.maxChars = Math.max(1, toInt(merged.maxChars, DEFAULTS.maxChars));
  merged.maxPerMessage = Math.max(
    1,
    toInt(merged.maxPerMessage, DEFAULTS.maxPerMessage),
  );
  merged.maxAgeDays = Math.max(
    0,
    toInt(merged.maxAgeDays, DEFAULTS.maxAgeDays),
  );
  merged.enabled = toBool(merged.enabled, DEFAULTS.enabled);
  merged.includeAssistant = toBool(
    merged.includeAssistant,
    DEFAULTS.includeAssistant,
  );
  merged.showTime = toBool(merged.showTime, DEFAULTS.showTime);
  merged.debug = toBool(merged.debug, DEFAULTS.debug);

  merged.openMode = pickOpenMode(String(merged.openMode ?? DEFAULTS.openMode));
  merged.nvrWaitMode = pickWaitMode(
    String(merged.nvrWaitMode ?? DEFAULTS.nvrWaitMode),
  );
  merged.workingMode = pickWorkingMode(
    String(merged.workingMode ?? DEFAULTS.workingMode),
  );
  merged.emptyPolicy = pickEmptyPolicy(
    String(merged.emptyPolicy ?? DEFAULTS.emptyPolicy),
  );
  merged.errorPolicy = pickErrorPolicy(
    String(merged.errorPolicy ?? DEFAULTS.errorPolicy),
  );

  const sources = {};
  for (const key of CONFIG_KEYS) {
    if (hasOwn(envLayer, key)) {
      sources[key] = "env";
    } else if (hasOwn(projectLayer, key)) {
      sources[key] = "project";
    } else if (hasOwn(userLayer, key)) {
      sources[key] = "user";
    } else {
      sources[key] = "default";
    }
  }

  return {
    config: merged,
    meta: {
      userConfigPath,
      projectConfigPath,
      sources,
      layers: {
        user: userLayer,
        project: projectLayer,
        env: envLayer,
      },
    },
  };
}

async function resolveConfig(env, cwd, overrides = {}) {
  const { config } = await resolveConfigDetailed(env, cwd, overrides);
  return config;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ note: "unserializable-payload" });
  }
}

async function appendDebug(enabled, message, payload = undefined) {
  if (!enabled) return;

  try {
    const debugPath = path.join(
      os.homedir(),
      ".local",
      "state",
      "pi-editor",
      "debug.log",
    );
    const serialized = payload === undefined ? "" : ` ${safeJson(payload)}`;
    const line = `${new Date().toISOString()} ${message}${serialized}\n`;
    await fs.mkdir(path.dirname(debugPath), { recursive: true });
    await fs.appendFile(debugPath, line, "utf8");
  } catch {
    // Debug logging must never break editor flow.
  }
}

async function listJsonlFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

async function newestFile(paths) {
  let winner = "";
  let winnerMtime = -1;
  for (const candidate of paths) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.mtimeMs > winnerMtime) {
        winnerMtime = stat.mtimeMs;
        winner = candidate;
      }
    } catch {
      // Ignore invalid candidates.
    }
  }
  return winner;
}

async function resolveSessionsRoot(config, env) {
  if (env.PI_EDITOR_SESSIONS_DIR) return env.PI_EDITOR_SESSIONS_DIR;
  if (env.PI_CODING_AGENT_DIR)
    return path.join(env.PI_CODING_AGENT_DIR, "sessions");
  if (config.sessionsDir) return config.sessionsDir;
  return path.join(os.homedir(), ".pi", "agent", "sessions");
}

async function discoverSessionFileDetailed(config, env, cwdRaw) {
  if (config.sessionFile) {
    return {
      sessionPath: config.sessionFile,
      selectedSource: "config.sessionFile",
      sessionsRoot: "",
      cwdRaw,
      cwdReal: cwdRaw,
      bucketCandidates: [],
      bucketHits: [],
      bucketFileCount: 0,
      globalFileCount: 0,
    };
  }

  const sessionsRoot = await resolveSessionsRoot(config, env);
  if (!(await fileExists(sessionsRoot))) {
    return {
      sessionPath: "",
      selectedSource: "none",
      sessionsRoot,
      cwdRaw,
      cwdReal: cwdRaw,
      bucketCandidates: [],
      bucketHits: [],
      bucketFileCount: 0,
      globalFileCount: 0,
    };
  }

  let cwdReal = cwdRaw;
  try {
    cwdReal = await fs.realpath(cwdRaw);
  } catch {
    cwdReal = cwdRaw;
  }

  const bucketCandidates = Array.from(
    new Set([
      cwdToBucket(cwdRaw),
      cwdToBucket(cwdReal),
      encodeURIComponent(cwdRaw),
      encodeURIComponent(cwdReal),
      cwdRaw,
      cwdReal,
    ]),
  );

  const bucketFiles = [];
  const bucketHits = [];
  for (const bucket of bucketCandidates) {
    const bucketPath = path.join(sessionsRoot, bucket);
    if (await fileExists(bucketPath)) {
      const files = await listJsonlFiles(bucketPath);
      bucketFiles.push(...files);
      bucketHits.push({ bucket, bucketPath, files: files.length });
    }
  }

  if (bucketFiles.length > 0) {
    return {
      sessionPath: await newestFile(bucketFiles),
      selectedSource: "bucket",
      sessionsRoot,
      cwdRaw,
      cwdReal,
      bucketCandidates,
      bucketHits,
      bucketFileCount: bucketFiles.length,
      globalFileCount: 0,
    };
  }

  const globalFiles = await listJsonlFiles(sessionsRoot);
  if (globalFiles.length === 0) {
    return {
      sessionPath: "",
      selectedSource: "none",
      sessionsRoot,
      cwdRaw,
      cwdReal,
      bucketCandidates,
      bucketHits,
      bucketFileCount: 0,
      globalFileCount: 0,
    };
  }

  return {
    sessionPath: await newestFile(globalFiles),
    selectedSource: "global",
    sessionsRoot,
    cwdRaw,
    cwdReal,
    bucketCandidates,
    bucketHits,
    bucketFileCount: 0,
    globalFileCount: globalFiles.length,
  };
}

async function discoverSessionFile(config, env, cwdRaw) {
  const details = await discoverSessionFileDetailed(config, env, cwdRaw);
  return details.sessionPath;
}

function parseTimestampMs(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim().length <= 13) {
    return numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getEntryTimestamp(entry) {
  return (
    parseTimestampMs(entry?.timestamp) ||
    parseTimestampMs(entry?.message?.timestamp) ||
    parseTimestampMs(entry?.createdAt) ||
    0
  );
}

function entryId(entry) {
  return typeof entry?.id === "string" ? entry.id : "";
}

function entryParentId(entry) {
  return typeof entry?.parentId === "string" ? entry.parentId : "";
}

function extractTextFromBlock(block) {
  if (!block) return "";
  if (typeof block === "string") return block;
  if (typeof block.text === "string") return block.text;
  if (typeof block.value === "string") return block.value;
  return "";
}

function extractMessageText(message, role) {
  if (!message || typeof message !== "object") return "";

  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;

  if (!Array.isArray(message.content)) return "";

  const visibleAssistantTypes = new Set(["text", "output_text"]);
  const visibleUserTypes = new Set(["text", "input_text", "output_text"]);
  const visibleTypes =
    role === "assistant" ? visibleAssistantTypes : visibleUserTypes;

  const chunks = [];
  for (const block of message.content) {
    if (typeof block === "string") {
      chunks.push(block);
      continue;
    }

    if (!block || typeof block !== "object") continue;
    const blockType = typeof block.type === "string" ? block.type : "";
    if (blockType && !visibleTypes.has(blockType)) continue;

    const text = extractTextFromBlock(block);
    if (text) chunks.push(text);
  }

  return chunks.join("\n").trim();
}

async function parseJsonlSession(sessionPath) {
  const raw = await fs.readFile(sessionPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const entries = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL at line ${i + 1}`);
    }

    entries.push({ ...parsed, __lineIndex: i });
  }

  return entries;
}

function selectBranch(entries) {
  const idMap = new Map();
  const parentRefs = new Set();

  for (const entry of entries) {
    const id = entryId(entry);
    if (!id) continue;
    idMap.set(id, entry);

    const parent = entryParentId(entry);
    if (parent) parentRefs.add(parent);
  }

  const leaves = [...idMap.values()].filter(
    (entry) => !parentRefs.has(entryId(entry)),
  );
  if (leaves.length === 0) {
    return { selectedLeaf: null, branchEntries: [], leavesCount: 0 };
  }

  leaves.sort((a, b) => {
    const ts = getEntryTimestamp(a) - getEntryTimestamp(b);
    if (ts !== 0) return ts;
    return (a.__lineIndex ?? 0) - (b.__lineIndex ?? 0);
  });

  const selectedLeaf = leaves[leaves.length - 1];
  const branchEntries = [];
  const seen = new Set();
  let cursor = selectedLeaf;

  while (cursor) {
    const id = entryId(cursor);
    if (!id || seen.has(id)) break;
    seen.add(id);
    branchEntries.push(cursor);

    const parent = entryParentId(cursor);
    if (!parent) break;
    cursor = idMap.get(parent);
  }

  branchEntries.reverse();
  return { selectedLeaf, branchEntries, leavesCount: leaves.length };
}

function buildContext(branchEntries, config) {
  if (!config.enabled) {
    return {
      contextText: "",
      injectedCount: 0,
      stats: {
        enabled: false,
        branchEntries: branchEntries.length,
        messageEntries: 0,
        includedByRole: 0,
        skippedByRole: 0,
        skippedByAge: 0,
        skippedEmpty: 0,
        perMessageTruncated: 0,
        extractedMessages: 0,
        recentWindowSize: 0,
        maxCharsTruncated: false,
      },
    };
  }

  const cutoff =
    config.maxAgeDays > 0
      ? Date.now() - config.maxAgeDays * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;

  const extracted = [];
  let messageEntries = 0;
  let includedByRole = 0;
  let skippedByRole = 0;
  let skippedByAge = 0;
  let skippedEmpty = 0;
  let perMessageTruncated = 0;

  for (const entry of branchEntries) {
    if (entry?.type !== "message") continue;
    messageEntries += 1;

    const role = entry?.message?.role;
    if (role !== "user" && role !== "assistant") {
      skippedByRole += 1;
      continue;
    }
    if (role === "assistant" && !config.includeAssistant) {
      skippedByRole += 1;
      continue;
    }
    includedByRole += 1;

    const ts = getEntryTimestamp(entry);
    if (ts < cutoff) {
      skippedByAge += 1;
      continue;
    }

    const rawText = extractMessageText(entry.message, role);
    if (!rawText) {
      skippedEmpty += 1;
      continue;
    }

    const sanitized = stripAnsiAndControl(normalizeEol(rawText));
    if (sanitized.length > config.maxPerMessage) {
      perMessageTruncated += 1;
    }

    const bounded = truncate(sanitized, config.maxPerMessage).trim();
    if (!bounded) {
      skippedEmpty += 1;
      continue;
    }

    const prefix = role === "user" ? "U" : "A";
    const timeTag =
      config.showTime && ts > 0 ? ` [${new Date(ts).toISOString()}]` : "";
    const lines = bounded.split("\n");
    const formatted = [`${prefix}${timeTag}: ${lines[0]}`]
      .concat(lines.slice(1).map((line) => `   ${line}`))
      .join("\n");

    extracted.push(formatted);
  }

  const recent = extracted.slice(-config.messages);
  const selected = [];
  let usedChars = 0;
  let maxCharsTruncated = false;

  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const segment = recent[i];
    if (usedChars + segment.length <= config.maxChars) {
      selected.unshift(segment);
      usedChars += segment.length;
      continue;
    }

    maxCharsTruncated = true;
    const remaining = config.maxChars - usedChars;
    if (selected.length === 0 && remaining > 1) {
      selected.unshift(`${segment.slice(0, remaining - 1)}…`);
      usedChars = config.maxChars;
    }
    break;
  }

  return {
    contextText: selected.join("\n\n"),
    injectedCount: selected.length,
    stats: {
      enabled: true,
      branchEntries: branchEntries.length,
      messageEntries,
      includedByRole,
      skippedByRole,
      skippedByAge,
      skippedEmpty,
      perMessageTruncated,
      extractedMessages: extracted.length,
      recentWindowSize: recent.length,
      maxCharsTruncated,
    },
  };
}

function buildWorkingFile(contextText, promptBase) {
  const parts = [
    MARKERS.contextStart,
    contextText,
    MARKERS.contextEnd,
    "",
    MARKERS.promptStart,
    promptBase,
  ];
  return `${parts.join("\n")}\n`;
}

function extractPromptFromWorkingFile(content) {
  const normalized = normalizeEol(content);
  const index = normalized.indexOf(MARKERS.promptStart);
  if (index < 0) {
    return trimSingleTrailingNewline(normalized);
  }

  let prompt = normalized.slice(index + MARKERS.promptStart.length);
  if (prompt.startsWith("\n")) prompt = prompt.slice(1);
  return trimSingleTrailingNewline(prompt);
}

function commandAvailable(command) {
  const probe = spawnSync("bash", [
    "-lc",
    `command -v ${command} >/dev/null 2>&1`,
  ]);
  return probe.status === 0;
}

function runEditorCommand(command, args) {
  const child = spawnSync(command, args, { stdio: "inherit" });
  if (child.error) throw child.error;
  if (child.status !== 0)
    throw new Error(`${command} exited with status ${child.status}`);
}

function openEditor(filePath, config) {
  const nvrArgs =
    config.nvrWaitMode === "tab"
      ? ["--remote-wait-tab", filePath]
      : ["--remote-wait", filePath];

  if (config.openMode === "nvr") {
    runEditorCommand("nvr", nvrArgs);
    return {
      requestedMode: config.openMode,
      effectiveMode: "nvr",
      command: "nvr",
      waitMode: config.nvrWaitMode,
    };
  }

  if (config.openMode === "nvim") {
    runEditorCommand("nvim", [filePath]);
    return {
      requestedMode: config.openMode,
      effectiveMode: "nvim",
      command: "nvim",
      waitMode: "process",
    };
  }

  if (commandAvailable("nvr")) {
    try {
      runEditorCommand("nvr", nvrArgs);
      return {
        requestedMode: config.openMode,
        effectiveMode: "nvr",
        command: "nvr",
        waitMode: config.nvrWaitMode,
      };
    } catch (error) {
      runEditorCommand("nvim", [filePath]);
      return {
        requestedMode: config.openMode,
        effectiveMode: "nvim",
        command: "nvim",
        waitMode: "process",
        fallbackFrom: "nvr",
        nvrError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  runEditorCommand("nvim", [filePath]);
  return {
    requestedMode: config.openMode,
    effectiveMode: "nvim",
    command: "nvim",
    waitMode: "process",
    fallbackFrom: "nvr-unavailable",
  };
}

async function createWorkingPath(config, originalTempPath) {
  if (config.workingMode === "persistent") {
    const parent = path.dirname(originalTempPath);
    const base = path.basename(originalTempPath);
    return path.join(parent, `${base}.pi-editor-context.md`);
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-editor-context-"));
  return path.join(dir, "working.md");
}

async function runEditorContext(options) {
  const {
    tempFile,
    env = process.env,
    openEditorImpl = openEditor,
    fallbackEditorImpl = (fallbackPath) =>
      runEditorCommand("nvim", [fallbackPath]),
    configOverrides = undefined,
  } = options;

  if (!tempFile) {
    throw new Error("Usage: pi-editor-context.mjs <pi-temp-file>");
  }

  const cwd = resolveCwd(env);
  const { config, meta: configMeta } = await resolveConfigDetailed(
    env,
    cwd,
    configOverrides,
  );

  try {
    await appendDebug(config.debug, "config-resolved", {
      cwd,
      config,
      sourceByField: configMeta.sources,
      configPaths: {
        user: configMeta.userConfigPath,
        project: configMeta.projectConfigPath,
      },
    });

    const originalPromptRaw = await fs.readFile(tempFile, "utf8");
    const originalPrompt = trimSingleTrailingNewline(
      normalizeEol(originalPromptRaw),
    );

    const sessionDiscovery = await discoverSessionFileDetailed(
      config,
      env,
      cwd,
    );
    const sessionPath = sessionDiscovery.sessionPath;
    await appendDebug(config.debug, "session-discovery", sessionDiscovery);

    let contextText = "";
    let selectedLeafId = "";
    let injectedCount = 0;
    let contextStats = {
      enabled: config.enabled,
      branchEntries: 0,
      messageEntries: 0,
      includedByRole: 0,
      skippedByRole: 0,
      skippedByAge: 0,
      skippedEmpty: 0,
      perMessageTruncated: 0,
      extractedMessages: 0,
      recentWindowSize: 0,
      maxCharsTruncated: false,
    };

    if (sessionPath && config.enabled) {
      const entries = await parseJsonlSession(sessionPath);
      const { selectedLeaf, branchEntries, leavesCount } =
        selectBranch(entries);
      selectedLeafId = entryId(selectedLeaf);
      await appendDebug(config.debug, "branch-selection", {
        selectedLeafId,
        leavesCount,
        branchEntries: branchEntries.length,
      });

      const context = buildContext(branchEntries, config);
      contextText = context.contextText;
      injectedCount = context.injectedCount;
      contextStats = context.stats;
    }

    await appendDebug(config.debug, "context-built", {
      sessionPath,
      selectedLeafId,
      injectedCount,
      contextChars: contextText.length,
      contextStats,
    });

    const workingPath = await createWorkingPath(config, tempFile);
    await fs.mkdir(path.dirname(workingPath), { recursive: true });
    await fs.writeFile(
      workingPath,
      buildWorkingFile(contextText, originalPrompt),
      "utf8",
    );

    const editorDecision = await Promise.resolve(
      openEditorImpl(workingPath, config),
    );
    await appendDebug(config.debug, "editor-open", {
      workingPath,
      requestedMode: config.openMode,
      nvrWaitMode: config.nvrWaitMode,
      editorDecision: editorDecision ?? {
        requestedMode: config.openMode,
        effectiveMode: "custom-open-editor-impl",
      },
    });

    const edited = await fs.readFile(workingPath, "utf8");
    let promptOut = extractPromptFromWorkingFile(edited);

    if (config.emptyPolicy === "restore" && promptOut.trim().length === 0) {
      promptOut = originalPrompt;
    }

    await fs.writeFile(tempFile, promptOut, "utf8");
    await appendDebug(config.debug, "exported", {
      outputChars: promptOut.length,
      outputBytes: Buffer.byteLength(promptOut, "utf8"),
      inputPromptChars: originalPrompt.length,
      inputPromptBytes: Buffer.byteLength(originalPrompt, "utf8"),
      contextChars: contextText.length,
      contextBytes: Buffer.byteLength(contextText, "utf8"),
      contextExported: false,
    });

    if (config.workingMode === "temp") {
      await fs.rm(path.dirname(workingPath), { recursive: true, force: true });
    }

    return {
      status: "ok",
      config,
      selectedLeafId,
      injectedCount,
      contextChars: contextText.length,
    };
  } catch (error) {
    await appendDebug(config.debug, "error", {
      message: error instanceof Error ? error.message : String(error),
    });

    if (config.errorPolicy === "hard") {
      throw error;
    }

    try {
      await Promise.resolve(fallbackEditorImpl(tempFile, config));
    } catch {
      // Last-resort: never hard fail in soft mode.
    }

    return {
      status: "soft-recovered",
      config,
      selectedLeafId: "",
      injectedCount: 0,
      contextChars: 0,
    };
  }
}

async function main() {
  const tempFile = process.argv[2];
  if (!tempFile) {
    console.error("Usage: pi-editor-context.mjs <pi-temp-file>");
    process.exit(2);
  }

  try {
    await runEditorContext({ tempFile });
  } catch (error) {
    console.error(
      `[pi-editor-context] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  await main();
}

export {
  DEFAULTS,
  MARKERS,
  buildContext,
  buildWorkingFile,
  discoverSessionFile,
  extractPromptFromWorkingFile,
  extractMessageText,
  parseJsonlSession,
  resolveConfig,
  runEditorContext,
  selectBranch,
};
