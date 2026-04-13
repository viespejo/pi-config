import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import { computeWriteDiffPreviewLocal } from "../src/index.ts";

describe("computeWriteDiffPreviewLocal", () => {
  it("returns an all-added diff when target file does not exist", async () => {
    const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-write-new-"));
    const relPath = "new-file.txt";
    const res = await computeWriteDiffPreviewLocal(
      relPath,
      "first line\nsecond line\n",
      dir,
    );

    assert.ok(!("error" in res), "expected a diff result");
    assert.equal(res.existedBeforeWrite, false);
    assert.match(res.diff, /\+1 first line/);
    assert.match(res.diff, /\+2 second line/);
  });

  it("returns a regular diff for overwrite writes", async () => {
    const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-write-overwrite-"));
    const relPath = "existing.txt";
    await fs.writeFile(nodePath.join(dir, relPath), "hello\nthere\n", "utf-8");

    const res = await computeWriteDiffPreviewLocal(relPath, "hello\nworld\n", dir);

    assert.ok(!("error" in res), "expected a diff result");
    assert.equal(res.existedBeforeWrite, true);
    assert.match(res.diff, /-2 there/);
    assert.match(res.diff, /\+2 world/);
  });

  it("returns an explicit no-op error when content is unchanged", async () => {
    const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-write-same-"));
    const relPath = "same.txt";
    await fs.writeFile(nodePath.join(dir, relPath), "unchanged\n", "utf-8");

    const res = await computeWriteDiffPreviewLocal(relPath, "unchanged\n", dir);

    assert.ok("error" in res, "expected a no-op error");
    assert.match(res.error, /No changes made/);
  });
});
