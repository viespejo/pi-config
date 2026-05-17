import {
  CURSOR_MARKER,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";

export type CustomFn = <T>(
  factory: (
    tui: { requestRender: () => void },
    theme: {
      fg?: (color: string, text: string) => string;
      bg?: (color: string, text: string) => string;
      bold?: (text: string) => string;
    },
    keybindings: unknown,
    done: (result: T) => void,
  ) => Component | Promise<Component>,
  options?: unknown,
) => Promise<T>;

export type ApprovalSelectUI = {
  select: (prompt: string, options: string[], opts?: unknown) => Promise<string | undefined>;
  custom?: CustomFn;
  editor?: (label: string, initialText?: string) => Promise<string | undefined>;
};

export type ApprovalSelectResult = {
  choice: string | undefined;
  note?: string;
  aborted?: boolean;
  editInEditor?: boolean;
};

export type ApprovalSelectOptions = {
  editableChoices?: readonly string[];
};

type ThemeLike = Parameters<CustomFn>[0] extends (
  tui: any,
  theme: infer T,
  keybindings: any,
  done: any,
) => any
  ? T
  : never;

const DEFAULT_EDITABLE_CHOICES = ["Yes", "No", "Block"] as const;
const INLINE_NOTE_PREVIEW_LIMIT = 80;

function isEditableChoice(choice: string, editableChoices: readonly string[]) {
  return editableChoices.includes(choice);
}

function isPrintable(data: string) {
  return data.length === 1 && data >= " " && data !== "\x7f";
}

type ApprovalSelectWithInlineNoteParams = {
  prompt: string;
  options: string[];
  theme: ThemeLike;
  requestRender: () => void;
  done: (result: ApprovalSelectResult) => void;
  editableChoices: readonly string[];
  initialEditChoice?: string;
  initialNote?: string;
};

class ApprovalSelectWithInlineNote implements Component, Focusable {
  focused = false;
  private selected = 0;
  private editing = false;
  private editChoice: string | undefined;
  private note = "";
  private cursor = 0;
  private readonly params: ApprovalSelectWithInlineNoteParams;

  constructor(params: ApprovalSelectWithInlineNoteParams) {
    this.params = params;
    if (params.initialEditChoice) {
      const initialIndex = params.options.indexOf(params.initialEditChoice);
      if (initialIndex >= 0) this.selected = initialIndex;
      this.editing = true;
      this.editChoice = params.initialEditChoice;
      this.note = params.initialNote ?? "";
      this.cursor = this.note.length;
    }
  }

  handleInput(data: string): void {
    if (this.editing) {
      this.handleEditingInput(data);
      return;
    }

    if ((matchesKey(data, Key.up) || data === "k") && this.selected > 0) {
      this.selected--;
      this.requestRender();
      return;
    }
    if (
      (matchesKey(data, Key.down) || data === "j") &&
      this.selected < this.params.options.length - 1
    ) {
      this.selected++;
      this.requestRender();
      return;
    }
    if (
      matchesKey(data, Key.tab) &&
      isEditableChoice(this.currentChoice(), this.params.editableChoices)
    ) {
      this.editing = true;
      this.editChoice = this.currentChoice();
      this.note = "";
      this.cursor = 0;
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.params.done({ choice: this.currentChoice() });
      return;
    }
    if (matchesKey(data, Key.ctrl("c"))) {
      this.params.done({ choice: undefined, aborted: true });
      return;
    }
    if (matchesKey(data, Key.escape)) {
      return;
    }
  }

  private handleEditingInput(data: string) {
    if (matchesKey(data, Key.enter)) {
      this.params.done({ choice: this.editChoice, note: this.note.trim() || undefined });
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.editing = false;
      this.editChoice = undefined;
      this.note = "";
      this.cursor = 0;
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.ctrl("e"))) {
      this.params.done({
        choice: this.editChoice,
        note: this.note,
        editInEditor: true,
      });
      return;
    }
    if (matchesKey(data, Key.left) && this.cursor > 0) {
      this.cursor--;
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.right) && this.cursor < this.note.length) {
      this.cursor++;
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.cursor = 0;
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.cursor = this.note.length;
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.backspace) && this.cursor > 0) {
      this.note = this.note.slice(0, this.cursor - 1) + this.note.slice(this.cursor);
      this.cursor--;
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.delete) && this.cursor < this.note.length) {
      this.note = this.note.slice(0, this.cursor) + this.note.slice(this.cursor + 1);
      this.requestRender();
      return;
    }
    if (isPrintable(data)) {
      this.note = this.note.slice(0, this.cursor) + data + this.note.slice(this.cursor);
      this.cursor++;
      this.requestRender();
    }
  }

  render(width: number): string[] {
    const lines = this.params.prompt.split("\n").flatMap((line) => this.wrap(line, width));
    if (lines.length > 0) lines.push("");

    for (let index = 0; index < this.params.options.length; index++) {
      lines.push(this.renderOption(index, width));
    }

    lines.push("");
    lines.push(this.dim(this.editing
      ? this.noteNeedsEditorHint()
        ? "long note • Ctrl+E editor • Enter confirm • Esc back"
        : "type note • Enter confirm • Ctrl+E editor • Esc back"
      : `↑↓/j/k navigate • Enter select • Tab note on ${this.params.editableChoices.join("/")} • Ctrl+C abort`));

    return lines.map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {}

  private renderOption(index: number, width: number) {
    const choice = this.params.options[index]!;
    const selected = index === this.selected;
    const prefix = selected ? "> " : "  ";
    let text = choice;

    if (this.editing && this.editChoice === choice) {
      text = `${choice}, ${this.renderInlineNotePreview()}`;
    }

    const line = prefix + text;
    return selected ? this.accent(truncateToWidth(line, width)) : truncateToWidth(line, width);
  }

  private currentChoice() {
    return this.params.options[this.selected] ?? "";
  }

  private noteNeedsEditorHint() {
    return (
      this.note.length > INLINE_NOTE_PREVIEW_LIMIT ||
      this.note.includes("\n") ||
      this.note.includes("\r")
    );
  }

  private renderInlineNotePreview() {
    if (!this.noteNeedsEditorHint()) {
      const before = this.note.slice(0, this.cursor);
      const at = this.note[this.cursor] ?? " ";
      const after = this.note.slice(this.cursor + (this.note[this.cursor] ? 1 : 0));
      return `${before}${this.focused ? CURSOR_MARKER : ""}\x1b[7m${at}\x1b[27m${after}`;
    }

    const singleLine = this.note.replace(/\r?\n/g, " ⏎ ");
    const preview = truncateToWidth(singleLine, INLINE_NOTE_PREVIEW_LIMIT, "…");
    return `${preview} ${this.dim("[Ctrl+E]")}`;
  }

  private requestRender() {
    this.invalidate();
    this.params.requestRender();
  }

  private accent(text: string) {
    return this.params.theme.fg?.("accent", text) ?? text;
  }

  private dim(text: string) {
    return this.params.theme.fg?.("dim", text) ?? text;
  }

  private wrap(line: string, width: number) {
    if (visibleWidth(line) <= width) return [line];
    const out: string[] = [];
    let rest = line;
    while (visibleWidth(rest) > width) {
      out.push(truncateToWidth(rest, width));
      rest = rest.slice(Math.max(1, width));
    }
    if (rest) out.push(rest);
    return out;
  }
}

export async function approvalSelectWithInlineNote(
  ui: ApprovalSelectUI,
  prompt: string,
  options: string[],
  selectOptions: ApprovalSelectOptions = {},
): Promise<ApprovalSelectResult> {
  if (typeof ui.custom !== "function") {
    return { choice: await ui.select(prompt, options) };
  }

  const editableChoices =
    selectOptions.editableChoices ?? DEFAULT_EDITABLE_CHOICES;
  let initialEditChoice: string | undefined;
  let initialNote: string | undefined;

  while (true) {
    const result = await ui.custom<ApprovalSelectResult>((tui, theme, _keybindings, done) => {
      return new ApprovalSelectWithInlineNote({
        prompt,
        options,
        theme,
        requestRender: () => tui.requestRender(),
        done,
        editableChoices,
        initialEditChoice,
        initialNote,
      });
    });

    if (!result || typeof result !== "object") {
      return { choice: await ui.select(prompt, options) };
    }

    if (!result.editInEditor) {
      return result;
    }

    if (typeof ui.editor !== "function") {
      initialEditChoice = result.choice;
      initialNote = result.note ?? "";
      continue;
    }

    const edited = await ui.editor(`${result.choice}, note`, result.note ?? "");
    if (typeof edited === "string") {
      return { choice: result.choice, note: edited.trim() || undefined };
    }

    initialEditChoice = result.choice;
    initialNote = result.note ?? "";
  }
}
