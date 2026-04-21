import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import nodePath from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const READ_HARD_DENY_BASENAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "authorized_keys",
]);

const READ_HARD_DENY_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
]);

const READ_ASK_BASENAMES = new Set([
  ".npmrc",
  ".pypirc",
  ".git-credentials",
]);

const READ_HARD_DENY_SEGMENTS = new Set([".ssh"]);
const READ_ASK_SEGMENTS = new Set([".aws", ".kube", ".gnupg"]);
const ENV_EXAMPLE_VARIANTS = [".example", ".sample", ".template", ".dist"];

type ReadPathInfo = {
  rawPath: string;
  resolvedPath: string;
  realPath?: string;
};

export type ReadAssessment = {
  hardDenyReason?: string;
  askReasons: string[];
  pathLabel: string;
};

function expandHomePath(inputPath: string) {
  const trimmed = inputPath.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return nodePath.join(homedir(), trimmed.slice(2));
  return trimmed;
}

function formatPathForPrompt(pathValue: string, cwd: string) {
  const normalized = pathValue.replace(/\\/g, "/");
  const rel = nodePath.relative(cwd, pathValue);
  if (!rel.startsWith("..") && !nodePath.isAbsolute(rel)) {
    return rel.replace(/\\/g, "/") || ".";
  }

  const home = homedir().replace(/\\/g, "/");
  if (normalized.startsWith(`${home}/`) || normalized === home) {
    return normalized.replace(home, "~");
  }

  return `.../${nodePath.basename(pathValue)}`;
}

function isOutsideCwdPath(targetPath: string, cwd: string) {
  const rel = nodePath.relative(cwd, targetPath);
  return rel.startsWith("..") || nodePath.isAbsolute(rel);
}

function isEnvExampleVariant(baseName: string) {
  return ENV_EXAMPLE_VARIANTS.some((suffix) => baseName.endsWith(suffix));
}

async function resolveReadPathInfo(
  rawPath: string,
  cwd: string,
): Promise<ReadPathInfo> {
  const expandedPath = expandHomePath(rawPath);
  const resolvedPath = nodePath.resolve(cwd, expandedPath);

  try {
    const realPath = await fs.realpath(resolvedPath);
    return {
      rawPath,
      resolvedPath,
      realPath,
    };
  } catch {
    return {
      rawPath,
      resolvedPath,
    };
  }
}

async function isGitIgnoredPath(rawPath: string, cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", cwd, "check-ignore", "-q", "--", rawPath]);
    return true;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: number | string }).code
        : undefined;

    if (code === 1 || code === "1") return false;
    return false;
  }
}

function classifyReadSensitivity(info: ReadPathInfo, cwd: string): ReadAssessment {
  const candidates = [info.resolvedPath, ...(info.realPath ? [info.realPath] : [])];
  const askReasons = new Set<string>();

  for (const candidate of candidates) {
    const normalized = candidate.replace(/\\/g, "/").toLowerCase();
    const base = nodePath.basename(normalized);
    const ext = nodePath.extname(normalized);
    const segments = normalized.split("/").filter(Boolean);

    if (base === ".env") {
      return {
        hardDenyReason: "Environment files may contain secrets.",
        askReasons: [],
        pathLabel: formatPathForPrompt(candidate, cwd),
      };
    }

    if (base.startsWith(".env.") && !isEnvExampleVariant(base)) {
      return {
        hardDenyReason: "Environment variant file may contain secrets.",
        askReasons: [],
        pathLabel: formatPathForPrompt(candidate, cwd),
      };
    }

    if (READ_HARD_DENY_BASENAMES.has(base)) {
      return {
        hardDenyReason: `Sensitive credential filename detected (${base}).`,
        askReasons: [],
        pathLabel: formatPathForPrompt(candidate, cwd),
      };
    }

    if (READ_HARD_DENY_EXTENSIONS.has(ext)) {
      return {
        hardDenyReason: `Sensitive key/certificate extension detected (${ext}).`,
        askReasons: [],
        pathLabel: formatPathForPrompt(candidate, cwd),
      };
    }

    if (segments.some((segment) => READ_HARD_DENY_SEGMENTS.has(segment))) {
      return {
        hardDenyReason: "Path targets a restricted secrets directory (.ssh).",
        askReasons: [],
        pathLabel: formatPathForPrompt(candidate, cwd),
      };
    }

    if (segments.some((segment) => READ_ASK_SEGMENTS.has(segment))) {
      askReasons.add("Path targets an operational secrets directory.");
    }

    if (READ_ASK_BASENAMES.has(base)) {
      askReasons.add(`Sensitive credentials filename detected (${base}).`);
    }

    if (isOutsideCwdPath(candidate, cwd)) {
      askReasons.add("Target path is outside current working directory.");
    }
  }

  return {
    askReasons: [...askReasons],
    pathLabel: formatPathForPrompt(info.realPath ?? info.resolvedPath, cwd),
  };
}

export async function assessReadRequest(
  rawPath: string,
  cwd: string,
): Promise<ReadAssessment> {
  const info = await resolveReadPathInfo(rawPath, cwd);
  const classified = classifyReadSensitivity(info, cwd);
  if (classified.hardDenyReason) return classified;

  const askReasons = new Set(classified.askReasons);
  if (await isGitIgnoredPath(info.rawPath, cwd)) {
    askReasons.add("Target matches .gitignore rules.");
  }

  return {
    hardDenyReason: undefined,
    askReasons: [...askReasons],
    pathLabel: classified.pathLabel,
  };
}
