import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import { reviewInNeovim } from "../neovim-review.ts";

async function exists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

describe("neovim-review", () => {
  it("returns no-change when reviewed snapshot is unchanged", async () => {
    const cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-nvim-no-change-"));
    await fs.writeFile(nodePath.join(cwd, "file.txt"), "current\n", "utf-8");

    const result = await reviewInNeovim({
      cwd,
      filePath: "file.txt",
      proposedContent: "proposed\n",
      adapters: {
        spawnNvim: async () => ({ ok: true }),
      },
    });

    assert.deepEqual(result, { status: "no-change" });
  });

  it("returns changed when reviewed snapshot was modified", async () => {
    const cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-nvim-changed-"));
    await fs.writeFile(nodePath.join(cwd, "file.txt"), "before\n", "utf-8");

    const result = await reviewInNeovim({
      cwd,
      filePath: "file.txt",
      proposedContent: "after\n",
      adapters: {
        spawnNvim: async (args) => {
          const proposedSnapshot = args[2]!;
          await fs.writeFile(proposedSnapshot, "after reviewed\n", "utf-8");
          return { ok: true };
        },
      },
    });

    assert.deepEqual(result, {
      status: "changed",
      reviewedContent: "after reviewed\n",
    });
  });

  it("returns unavailable on launch failure and always cleans temp dir", async () => {
    const cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-nvim-unavailable-"));
    const captured: { tmpDir?: string } = {};

    const result = await reviewInNeovim({
      cwd,
      filePath: "missing.txt",
      proposedContent: "new\n",
      adapters: {
        mkdtemp: async (prefix) => {
          const dir = await fs.mkdtemp(prefix);
          captured.tmpDir = dir;
          return dir;
        },
        spawnNvim: async () => ({ ok: false, reason: "nvim not found" }),
      },
    });

    assert.deepEqual(result, { status: "unavailable", reason: "nvim not found" });
    assert.ok(captured.tmpDir);
    assert.equal(await exists(captured.tmpDir!), false);
  });
});
