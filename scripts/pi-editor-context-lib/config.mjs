import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKERS = {
  contextStart: "<!-- PI_CONTEXT_START -->",
  contextEnd: "<!-- PI_CONTEXT_END -->",
  promptStart: "<!-- PI_PROMPT_START -->",
};

const DEFAULTS = {
  enabled: true,
  messages: 12,
  sessionFile: "",
  sessionSource: "auto",
  includeAssistant: true,
  maxChars: 12000,
  maxPerMessage: 2000,
  maxAgeDays: 0,
  showTime: false,
  openMode: "auto",
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

function pickSessionSource(source) {
  return ["auto", "pi", "claude"].includes(source) ? source : "auto";
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
    sessionSource:
      env.PI_EDITOR_CONTEXT_SESSION_SOURCE || env.PI_EDITOR_SESSION_SOURCE,
    includeAssistant: toBool(
      env.PI_EDITOR_CONTEXT_INCLUDE_ASSISTANT,
      undefined,
    ),
    maxChars: toInt(env.PI_EDITOR_CONTEXT_MAX_CHARS, undefined),
    maxPerMessage: toInt(env.PI_EDITOR_CONTEXT_MAX_PER_MESSAGE, undefined),
    maxAgeDays: toInt(env.PI_EDITOR_CONTEXT_MAX_AGE_DAYS, undefined),
    showTime: toBool(env.PI_EDITOR_CONTEXT_SHOW_TIME, undefined),
    openMode: env.PI_EDITOR_OPEN_MODE,
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

  merged.sessionSource = pickSessionSource(
    String(merged.sessionSource ?? DEFAULTS.sessionSource),
  );

  merged.openMode = pickOpenMode(String(merged.openMode ?? DEFAULTS.openMode));
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

export { DEFAULTS, MARKERS, resolveConfig, resolveConfigDetailed };
