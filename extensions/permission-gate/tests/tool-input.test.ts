import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  extractEditInput,
  extractPathFromInput,
  extractWriteInput,
} from "../tool-input.ts";

describe("tool-input", () => {
  it("extracts path from path first", () => {
    assert.equal(extractPathFromInput({ path: "a.txt" }), "a.txt");
  });

  it("extracts path from file_path fallback", () => {
    assert.equal(extractPathFromInput({ file_path: "b.txt" }), "b.txt");
  });

  it("returns undefined path when neither path field exists", () => {
    assert.equal(extractPathFromInput({}), undefined);
  });

  it("extracts edit input with edits array", () => {
    const out = extractEditInput({ path: "x.ts", edits: [{ oldText: "a" }] });
    assert.equal(out.path, "x.ts");
    assert.deepEqual(out.edits, [{ oldText: "a" }]);
  });

  it("ignores non-array edits", () => {
    const out = extractEditInput({ file_path: "x.ts", edits: "oops" });
    assert.equal(out.path, "x.ts");
    assert.equal(out.edits, undefined);
  });

  it("extracts write content from content first", () => {
    const out = extractWriteInput({ path: "x", content: "hello", text: "ignored" });
    assert.equal(out.path, "x");
    assert.equal(out.content, "hello");
  });

  it("extracts write content from text fallback", () => {
    const out = extractWriteInput({ file_path: "x", text: "hello" });
    assert.equal(out.path, "x");
    assert.equal(out.content, "hello");
  });

  it("returns undefined content when content payload is invalid", () => {
    const out = extractWriteInput({ path: "x", content: 123 });
    assert.equal(out.path, "x");
    assert.equal(out.content, undefined);
  });
});
