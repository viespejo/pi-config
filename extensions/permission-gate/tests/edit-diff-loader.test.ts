import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { loadComputeEditsDiffOnce } from "../edit-diff-loader.ts";

describe("edit-diff-loader", () => {
  it("reuses a single in-flight promise", () => {
    const p1 = loadComputeEditsDiffOnce();
    const p2 = loadComputeEditsDiffOnce();
    assert.equal(p1, p2);
  });

  it("returns a structured loader result", async () => {
    const loaded = await loadComputeEditsDiffOnce();

    assert.equal(typeof loaded, "object");
    assert.notEqual(loaded.source, "none");
    if (loaded.fn !== undefined) {
      assert.equal(typeof loaded.fn, "function");
    }
  });
});
