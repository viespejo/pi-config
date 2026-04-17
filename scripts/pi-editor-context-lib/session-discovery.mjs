import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function cwdToBucket(cwdPath) {
  const compact = cwdPath
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `--${compact || "root"}--`;
}

function cwdToClaudeProjectBucket(cwdPath) {
  const compact = cwdPath
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-");
  return compact.startsWith("-") ? compact : `-${compact}`;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
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

async function fileMtimeMs(targetPath) {
  if (!targetPath) return -1;
  try {
    const stat = await fs.stat(targetPath);
    return stat.mtimeMs;
  } catch {
    return -1;
  }
}

function resolveSessionSourceHint(config, env) {
  if (config.sessionSource && config.sessionSource !== "auto") {
    return config.sessionSource;
  }

  const hasClaudeSignal =
    env.CLAUDECODE === "1" ||
    env.CLAUDE_CODE_ENTRYPOINT ||
    env.CLAUDE_PROJECT_DIR ||
    env.CLAUDE_SESSION_ID;
  if (hasClaudeSignal) return "claude";

  const hasPiSignal =
    env.PI_CODING_AGENT_DIR || env.PI_EDITOR_SESSIONS_DIR || env.PI_SESSION_ID;
  if (hasPiSignal) return "pi";

  return "none";
}

function resolvePiSessionsRoot(config, env) {
  if (env.PI_EDITOR_SESSIONS_DIR) return env.PI_EDITOR_SESSIONS_DIR;
  if (env.PI_CODING_AGENT_DIR)
    return path.join(env.PI_CODING_AGENT_DIR, "sessions");
  if (config.sessionsDir) return config.sessionsDir;
  return path.join(os.homedir(), ".pi", "agent", "sessions");
}

function resolveClaudeSessionsRoot(config, env) {
  if (env.PI_EDITOR_SESSIONS_DIR) return env.PI_EDITOR_SESSIONS_DIR;
  if (config.sessionsDir) return config.sessionsDir;
  if (env.CLAUDE_CONFIG_DIR)
    return path.join(env.CLAUDE_CONFIG_DIR, "projects");
  return path.join(os.homedir(), ".claude", "projects");
}

async function discoverForSource(sessionSource, config, env, cwdRaw, cwdReal) {
  const sessionsRoot =
    sessionSource === "claude"
      ? resolveClaudeSessionsRoot(config, env)
      : resolvePiSessionsRoot(config, env);

  if (!(await fileExists(sessionsRoot))) {
    return {
      sessionPath: "",
      selectedSource: "none",
      sessionSource,
      sessionsRoot,
      cwdRaw,
      cwdReal,
      bucketCandidates: [],
      bucketHits: [],
      bucketFileCount: 0,
      globalFileCount: 0,
      sessionPathMtimeMs: -1,
    };
  }

  const bucketCandidates =
    sessionSource === "claude"
      ? Array.from(
          new Set([
            cwdToClaudeProjectBucket(cwdRaw),
            cwdToClaudeProjectBucket(cwdReal),
            cwdRaw,
            cwdReal,
          ]),
        )
      : Array.from(
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
    const sessionPath = await newestFile(bucketFiles);
    return {
      sessionPath,
      selectedSource: "bucket",
      sessionSource,
      sessionsRoot,
      cwdRaw,
      cwdReal,
      bucketCandidates,
      bucketHits,
      bucketFileCount: bucketFiles.length,
      globalFileCount: 0,
      sessionPathMtimeMs: await fileMtimeMs(sessionPath),
    };
  }

  const globalFiles = await listJsonlFiles(sessionsRoot);
  if (globalFiles.length === 0) {
    return {
      sessionPath: "",
      selectedSource: "none",
      sessionSource,
      sessionsRoot,
      cwdRaw,
      cwdReal,
      bucketCandidates,
      bucketHits,
      bucketFileCount: 0,
      globalFileCount: 0,
      sessionPathMtimeMs: -1,
    };
  }

  const sessionPath = await newestFile(globalFiles);
  return {
    sessionPath,
    selectedSource: "global",
    sessionSource,
    sessionsRoot,
    cwdRaw,
    cwdReal,
    bucketCandidates,
    bucketHits,
    bucketFileCount: 0,
    globalFileCount: globalFiles.length,
    sessionPathMtimeMs: await fileMtimeMs(sessionPath),
  };
}

async function discoverSessionFileDetailed(config, env, cwdRaw) {
  if (config.sessionFile) {
    return {
      sessionPath: config.sessionFile,
      selectedSource: "config.sessionFile",
      sessionSource: resolveSessionSourceHint(config, env),
      sessionsRoot: "",
      cwdRaw,
      cwdReal: cwdRaw,
      bucketCandidates: [],
      bucketHits: [],
      bucketFileCount: 0,
      globalFileCount: 0,
      sessionPathMtimeMs: await fileMtimeMs(config.sessionFile),
      autoCandidates: [],
      autoSelectedFrom: "config.sessionFile",
    };
  }

  let cwdReal = cwdRaw;
  try {
    cwdReal = await fs.realpath(cwdRaw);
  } catch {
    cwdReal = cwdRaw;
  }

  if (config.sessionSource === "auto") {
    const [piResult, claudeResult] = await Promise.all([
      discoverForSource("pi", config, env, cwdRaw, cwdReal),
      discoverForSource("claude", config, env, cwdRaw, cwdReal),
    ]);

    const envHint = resolveSessionSourceHint(config, env);
    const ranked = [piResult, claudeResult].sort((a, b) => {
      if (b.sessionPathMtimeMs !== a.sessionPathMtimeMs) {
        return b.sessionPathMtimeMs - a.sessionPathMtimeMs;
      }
      if (a.sessionSource === envHint && b.sessionSource !== envHint) return -1;
      if (b.sessionSource === envHint && a.sessionSource !== envHint) return 1;
      return 0;
    });

    const winner = ranked[0];
    return {
      ...winner,
      autoCandidates: [
        {
          sessionSource: piResult.sessionSource,
          sessionPath: piResult.sessionPath,
          sessionPathMtimeMs: piResult.sessionPathMtimeMs,
          selectedSource: piResult.selectedSource,
          sessionsRoot: piResult.sessionsRoot,
        },
        {
          sessionSource: claudeResult.sessionSource,
          sessionPath: claudeResult.sessionPath,
          sessionPathMtimeMs: claudeResult.sessionPathMtimeMs,
          selectedSource: claudeResult.selectedSource,
          sessionsRoot: claudeResult.sessionsRoot,
        },
      ],
      autoSelectedFrom:
        winner.sessionPathMtimeMs >= 0 ? "latest-session" : "none",
      autoEnvHint: envHint,
    };
  }

  const explicit = await discoverForSource(
    config.sessionSource,
    config,
    env,
    cwdRaw,
    cwdReal,
  );

  return {
    ...explicit,
    autoCandidates: [],
    autoSelectedFrom: "explicit-source",
    autoEnvHint: resolveSessionSourceHint(config, env),
  };
}

async function discoverSessionFile(config, env, cwdRaw) {
  const details = await discoverSessionFileDetailed(config, env, cwdRaw);
  return details.sessionPath;
}

export { discoverSessionFile, discoverSessionFileDetailed };