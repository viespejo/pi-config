import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { showDiffInCustomDialog } from "../diff-viewer.ts";

type ViewerController = {
  render: (width: number) => string[];
  handleInput: (data: string) => void;
  invalidate: () => void;
};

async function openViewer(rendered: string, columns = 80, rows = 40) {
  let controller: ViewerController | undefined;
  let closed = false;

  const tui = {
    terminal: { columns, rows },
    requestRender() {},
  };

  const theme = {
    fg(_name: string, value: string) {
      return value;
    },
  };

  const ctx = {
    ui: {
      async custom(factory: any) {
        controller = factory(tui, theme, {}, () => {
          closed = true;
        });
      },
    },
  } as any;

  await showDiffInCustomDialog(ctx, "file.txt", rendered);

  if (!controller) throw new Error("Viewer controller was not created");

  return {
    controller,
    isClosed: () => closed,
  };
}

function frameText(frame: string[]) {
  return frame.join("\n");
}

describe("diff-viewer", () => {
  it("opens in Wrap mode by default and toggles with w", async () => {
    const { controller } = await openViewer("line 1\nline 2");

    let text = frameText(controller.render(80));
    assert.match(text, /Mode: Wrap/);

    controller.handleInput("w");
    text = frameText(controller.render(80));
    assert.match(text, /Mode: No-wrap/);

    controller.handleInput("w");
    text = frameText(controller.render(80));
    assert.match(text, /Mode: Wrap/);
  });

  it("supports gg and G navigation semantics", async () => {
    const rendered = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`).join("\n");
    const { controller } = await openViewer(rendered);

    controller.handleInput("G");
    let text = frameText(controller.render(80));
    assert.match(text, /Lines \d+-60 \/ 60/);

    controller.handleInput("g");
    text = frameText(controller.render(80));
    assert.match(text, /Lines \d+-60 \/ 60/);

    controller.handleInput("g");
    text = frameText(controller.render(80));
    assert.match(text, /Lines 1-\d+ \/ 60/);
  });

  it("ignores horizontal keys in Wrap mode", async () => {
    const rendered = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const { controller } = await openViewer(rendered, 30, 20);

    const before = frameText(controller.render(30));
    controller.handleInput("l");
    controller.handleInput("$");
    controller.handleInput("h");
    const after = frameText(controller.render(30));

    assert.equal(after, before);
  });

  it("supports horizontal movement in No-wrap and preserves it on vertical move", async () => {
    const rendered = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ\n0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const { controller } = await openViewer(rendered, 28, 20);

    controller.handleInput("w");
    let text = frameText(controller.render(28));
    assert.match(text, /0123456789/);

    controller.handleInput("l");
    controller.handleInput("l");
    controller.handleInput("l");
    text = frameText(controller.render(28));
    assert.match(text, /3456789ABC/);

    controller.handleInput("j");
    controller.handleInput("k");
    text = frameText(controller.render(28));
    assert.match(text, /3456789ABC/);

    controller.handleInput("0");
    text = frameText(controller.render(28));
    assert.match(text, /0123456789/);
  });

  it("resets horizontal offset on hunk jumps in No-wrap", async () => {
    const rendered = [
      "context",
      "+0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "context",
      "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "context",
    ].join("\n");

    const { controller } = await openViewer(rendered, 28, 20);
    controller.handleInput("w");

    controller.handleInput("l");
    controller.handleInput("l");
    controller.handleInput("]");

    const text = frameText(controller.render(28));
    assert.match(text, /\+0123456789|-0123456789/);
  });

  it("closes on q", async () => {
    const viewer = await openViewer("line");
    viewer.controller.handleInput("q");
    assert.equal(viewer.isClosed(), true);
  });
});
