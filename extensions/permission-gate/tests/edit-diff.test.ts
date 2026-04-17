import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import { computeEditsDiffLocalFallback } from "../edit-diff.ts";

describe("edit-diff", () => {
  it("returns diff for a valid unique edit", async () => {
    const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-edit-diff-ok-"));
    const relPath = "file.txt";
    await fs.writeFile(nodePath.join(dir, relPath), "one\ntwo\n", "utf-8");

    const res = await computeEditsDiffLocalFallback(
      relPath,
      [{ oldText: "two", newText: "three" }],
      dir,
    );

    assert.ok(!("error" in res));
    assert.match(res.diff, /-2 two/);
    assert.match(res.diff, /\+2 three/);
  });

  it("returns an error for missing files", async () => {
    const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-edit-diff-missing-"));

    const res = await computeEditsDiffLocalFallback(
      "missing.txt",
      [{ oldText: "a", newText: "b" }],
      dir,
    );

    assert.ok("error" in res);
    assert.match(res.error, /File not found/);
  });

  it("returns uniqueness errors for duplicate oldText matches", async () => {
    const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "pg-edit-diff-dup-"));
    const relPath = "dup.txt";
    await fs.writeFile(nodePath.join(dir, relPath), "x\ny\nx\n", "utf-8");

    const res = await computeEditsDiffLocalFallback(
      relPath,
      [{ oldText: "x", newText: "z" }],
      dir,
    );

    assert.ok("error" in res);
    assert.match(res.error, /must be unique/);
  });
});
