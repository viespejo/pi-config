import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { summarizeEditsForPrompt } from "../src/edit-preview.ts";

describe("edit-preview", () => {
  it("returns unknown-format message when edits is not an array", () => {
    assert.equal(summarizeEditsForPrompt(null), "Edits: (unknown format)");
  });

  it("builds a metadata summary with counts and examples", () => {
    const summary = summarizeEditsForPrompt(
      [
        { oldText: "a", newText: "b", start: 1, end: 2 },
        { oldText: "", newText: "inserted" },
        { oldText: "gone", newText: "" },
        { oldText: "x", newText: "y" },
      ],
      "src/file.ts",
    );

    assert.match(summary, /Path: src\/file\.ts/);
    assert.match(summary, /Total edits: 4 \(inserts=1, deletes=1, replaces=2\)/);
    assert.match(summary, /Total old chars: 6, total new chars: 10/);
    assert.match(summary, /Examples:/);
    assert.match(summary, /Edit 1: type=replace/);
    assert.match(summary, /range: 1-2/);
    assert.match(summary, /Note: detailed preview unavailable/);
  });

  it("caps examples to 3 entries", () => {
    const summary = summarizeEditsForPrompt([
      { oldText: "a", newText: "b" },
      { oldText: "c", newText: "d" },
      { oldText: "e", newText: "f" },
      { oldText: "g", newText: "h" },
    ]);

    const exampleLines = summary
      .split("\n")
      .filter((line) => line.trimStart().startsWith("- Edit "));
    assert.equal(exampleLines.length, 3);
  });
});
