import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  allowExecutionPrompt,
  APPROVAL_OPTION_NO,
  APPROVAL_OPTION_VIEW_DIFF,
  APPROVAL_OPTION_YES,
  APPROVAL_OPTION_YES_SESSION,
  DENY_REASON_LABEL,
  DENY_REASON_PLACEHOLDER,
  DIFF_APPROVAL_OPTIONS,
  diffViewedPrompt,
  previewUnavailablePrompt,
  previewUnavailableWithSourcePrompt,
  unexpectedPreviewErrorPrompt,
} from "../src/prompt-messages.ts";

describe("prompt-messages", () => {
  it("exposes expected approval options and deny labels", () => {
    assert.deepEqual(DIFF_APPROVAL_OPTIONS, [
      APPROVAL_OPTION_YES,
      APPROVAL_OPTION_VIEW_DIFF,
      APPROVAL_OPTION_YES_SESSION,
      APPROVAL_OPTION_NO,
    ]);
    assert.match(DENY_REASON_LABEL, /denied/i);
    assert.match(DENY_REASON_PLACEHOLDER, /LLM/i);
  });

  it("builds allow execution prompt", () => {
    const prompt = allowExecutionPrompt("write");
    assert.equal(prompt, "Tool: write\n\nAllow execution?");
  });

  it("builds preview unavailable prompt with and without metadata", () => {
    const withMeta = previewUnavailablePrompt("edit", "missing input.", "meta block");
    const withoutMeta = previewUnavailablePrompt("edit", "missing input.");

    assert.match(withMeta, /Preview unavailable: missing input\./);
    assert.match(withMeta, /meta block/);
    assert.match(withoutMeta, /Preview unavailable: missing input\./);
  });

  it("builds source-aware and diff-viewed prompts", () => {
    const source = previewUnavailableWithSourcePrompt(
      "write",
      "write:local",
      "No changes",
      "meta",
    );
    const viewed = diffViewedPrompt("edit", "local:fallback");

    assert.match(source, /Preview unavailable \(write:local\): No changes/);
    assert.match(viewed, /Diff viewed \(local:fallback\)/);
  });

  it("builds the unexpected preview error prompt", () => {
    const prompt = unexpectedPreviewErrorPrompt("write");
    assert.match(prompt, /unexpected error/i);
    assert.match(prompt, /Allow execution\?/);
  });
});
