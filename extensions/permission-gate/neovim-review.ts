import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

export type NeovimReviewResult =
  | { status: "no-change" }
  | { status: "changed"; reviewedContent: string }
  | { status: "unavailable"; reason: string };

type SpawnResult = { ok: true } | { ok: false; reason: string };

export type NeovimReviewAdapters = {
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile?: (
    path: string,
    content: string,
    encoding: BufferEncoding,
  ) => Promise<void>;
  mkdtemp?: (prefix: string) => Promise<string>;
  rm?: (
    path: string,
    options: { recursive: boolean; force: boolean },
  ) => Promise<void>;
  spawnNvim?: (args: string[]) => Promise<SpawnResult>;
};

export async function reviewInNeovim(params: {
  cwd: string;
  filePath: string;
  proposedContent: string;
  adapters?: NeovimReviewAdapters;
}): Promise<NeovimReviewResult> {
  const adapters = params.adapters ?? {};
  const readFile = adapters.readFile ?? fs.readFile;
  const writeFile = adapters.writeFile ?? fs.writeFile;
  const mkdtemp = adapters.mkdtemp ?? fs.mkdtemp;
  const rm = adapters.rm ?? fs.rm;
  const spawnNvim = adapters.spawnNvim ?? defaultSpawnNvim;

  const absolutePath = nodePath.resolve(params.cwd, params.filePath);

  let currentContent = "";
  try {
    currentContent = await readFile(absolutePath, "utf-8");
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code !== "ENOENT") {
      return {
        status: "unavailable",
        reason: `failed to read current file (${params.filePath})`,
      };
    }
  }

  let tmpDir: string | undefined;
  try {
    tmpDir = await mkdtemp(nodePath.join(os.tmpdir(), "pi-permission-gate-"));
    const currentSnapshot = nodePath.join(tmpDir, "current");
    const proposedSnapshot = nodePath.join(tmpDir, "proposed");

    await writeFile(currentSnapshot, currentContent, "utf-8");
    await writeFile(proposedSnapshot, params.proposedContent, "utf-8");

    const spawnResult = await spawnNvim([
      "-d",
      currentSnapshot,
      proposedSnapshot,
      "-c",
      "wincmd h | setlocal readonly nomodifiable | wincmd l",
      "-c",
      "autocmd QuitPre * qall",
    ]);

    if (!spawnResult.ok) {
      return {
        status: "unavailable",
        reason: spawnResult.reason,
      };
    }

    const reviewedContent = await readFile(proposedSnapshot, "utf-8");
    if (reviewedContent === params.proposedContent) {
      return { status: "no-change" };
    }

    return { status: "changed", reviewedContent };
  } catch (err) {
    return {
      status: "unavailable",
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (tmpDir) {
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        // best effort cleanup
      }
    }
  }
}

const commandExists = (commandName: string): boolean => {
  const probe = spawnSync("bash", [
    "-lc",
    `command -v ${commandName} >/dev/null 2>&1`,
  ]);
  return probe.status === 0;
};

const splitCommand = (
  command: string,
): { executable: string; args: string[] } => {
  const parts =
    command
      .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
      ?.map((part) => part.replace(/^['"]|['"]$/g, "")) ?? [];

  if (parts.length === 0) {
    return { executable: "nvim", args: [] };
  }

  return {
    executable: parts[0]!,
    args: parts.slice(1),
  };
};

const isPiEditorExecutable = (executable: string): boolean =>
  nodePath.basename(executable).toLowerCase() === "pi-editor";

const ensurePiEditorPlainModeArgs = (args: string[]): string[] => {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--mode") {
      return [...args];
    }
  }

  return ["--mode", "plain", ...args];
};

const stripPiEditorModeArgs = (args: string[]): string[] => {
  const nextArgs = [...args];
  for (let i = 0; i < nextArgs.length; i += 1) {
    if (nextArgs[i] === "--mode") {
      nextArgs.splice(i, 2);
      break;
    }
  }
  return nextArgs;
};

const buildPiEditorDiffArgs = (
  args: string[],
  originalFile: string,
  workingFile: string,
): string[] => {
  const extraArgs = stripPiEditorModeArgs(args);
  return [
    "--mode",
    "diff",
    originalFile,
    workingFile,
    ...(extraArgs.length > 0 ? ["--", ...extraArgs] : []),
  ];
};

const isVimLikeEditor = (editorName: string): boolean =>
  editorName === "nvim" ||
  editorName === "vim" ||
  editorName === "vi" ||
  editorName.endsWith("nvim") ||
  editorName.endsWith("vim");

const getPreferredEditorCommand = (): string => {
  const configured = process.env.PI_PERMISSION_GATE_EDITOR?.trim();
  if (configured) {
    return configured;
  }

  if (commandExists("pi-editor")) {
    return "pi-editor --mode plain";
  }

  return "nvim";
};
async function defaultSpawnNvim(args: string[]): Promise<SpawnResult> {
  try {
    const editorCmd = getPreferredEditorCommand();
    const { executable, args: baseArgs } = splitCommand(editorCmd);
    const editorName = nodePath.basename(executable).toLowerCase();

    const diffIndex = args.indexOf("-d");
    const diffOld = diffIndex >= 0 ? args[diffIndex + 1] : undefined;
    const diffNew = diffIndex >= 0 ? args[diffIndex + 2] : undefined;
    let editorArgs: string[];
    if (isPiEditorExecutable(executable) && diffOld && diffNew) {
      const piBaseArgs = ensurePiEditorPlainModeArgs(baseArgs);
      editorArgs = buildPiEditorDiffArgs(piBaseArgs, diffOld, diffNew);
    } else if (isVimLikeEditor(editorName)) {
      editorArgs = [...baseArgs, ...args];
    } else {
      editorArgs = [...baseArgs, ...args];
    }

    const res = spawnSync(executable, editorArgs, {
      stdio: "inherit",
      env: { ...process.env },
    });

    if (res.error) {
      return {
        ok: false,
        reason: `failed to launch editor (${editorCmd}): ${res.error.message}`,
      };
    }

    if (res.status === 0) {
      return { ok: true };
    }

    return {
      ok: false,
      reason: `${editorCmd} exited with code ${String(res.status)}`,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `failed to launch editor: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
