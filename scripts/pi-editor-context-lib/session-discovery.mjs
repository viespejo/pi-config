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

export { discoverSessionFile, discoverSessionFileDetailed };
