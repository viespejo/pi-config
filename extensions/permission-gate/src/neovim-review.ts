import { spawn } from "node:child_process";
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
  rm?: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
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

async function defaultSpawnNvim(args: string[]): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn("nvim", args, {
      stdio: "inherit",
      env: { ...process.env },
    });

    child.on("error", (err) => {
      resolve({
        ok: false,
        reason: `failed to launch nvim: ${err instanceof Error ? err.message : String(err)}`,
      });
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          reason: `nvim exited with code ${String(code)}`,
        });
      }
    });
  });
}
