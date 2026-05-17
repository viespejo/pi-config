export const APPROVAL_OPTION_YES = "Yes";
export const APPROVAL_OPTION_VIEW_DIFF = "View diff";
export const APPROVAL_OPTION_REVIEW_NVIM = "Review in Neovim";
export const APPROVAL_OPTION_YES_SESSION = "Yes, always this session";
export const APPROVAL_OPTION_NO = "No";

export const APPROVAL_OPTION_RUN_ONCE = "Run once";
export const APPROVAL_OPTION_RUN_HIGH_RISK_ONCE = "Run high-risk once";
export const APPROVAL_OPTION_READ_ONCE = "Read once";
export const APPROVAL_OPTION_EXPLAIN_COMMAND = "Explain command";
export const APPROVAL_OPTION_VIEW_DETAILS = "View details";
export const APPROVAL_OPTION_BLOCK = "Block";

export const RUN_CONFIRM_LABEL = "Type RUN to confirm";
export const RUN_CONFIRM_PLACEHOLDER = "RUN";

export const REVIEW_OPTION_APPLY = "Apply reviewed version";
export const REVIEW_OPTION_BACK = "Back to approval menu";

export const DIFF_APPROVAL_OPTIONS = [
  APPROVAL_OPTION_YES,
  APPROVAL_OPTION_VIEW_DIFF,
  APPROVAL_OPTION_REVIEW_NVIM,
  APPROVAL_OPTION_YES_SESSION,
  APPROVAL_OPTION_NO,
] as const;

export const DENY_REASON_LABEL = "Why was this denied? (optional)";
export const DENY_REASON_PLACEHOLDER = "Reason for the LLM";

export function allowExecutionPrompt(tool: string, target?: string) {
  const targetBlock =
    typeof target === "string" && target.length > 0
      ? `\n\nTarget: ${target}`
      : "";
  return `Tool: ${tool}${targetBlock}\n\nAllow execution?`;
}

export function readApprovalPrompt(pathLabel: string, reasons: string[]) {
  const body = reasons.map((item) => `- ${item}`).join("\n");
  return `Tool: read\n\nTarget: ${pathLabel}\n\nRead requires confirmation:\n${body}\n\nAllow execution?`;
}

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type BashExplanationPromptData = {
  summary: string;
  risks: string[];
  impact: string;
  recommendation: "safe-ish" | "caution" | "dangerous";
  flags?: string[];
  commandWasTruncated?: boolean;
};

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_GRAY = "\x1b[90m";

const gray = (text: string) => `${ANSI_GRAY}${text}${ANSI_RESET}`;
const dim = (text: string) => `${ANSI_DIM}${text}${ANSI_RESET}`;
const boldGray = (text: string) =>
  `${ANSI_BOLD}${ANSI_GRAY}${text}${ANSI_RESET}`;

function indentLines(text: string, prefix = "  ") {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function section(title: string, body: string) {
  return `${boldGray(`▌ ${title}`)}\n${indentLines(body)}`;
}

function bullets(items: string[], displayWidth?: number) {
  if (items.length === 0) return `${dim("- unknown")}`;
  return items
    .map((item) => `${dim("- ")}${previewReason(item, displayWidth)}`)
    .join("\n");
}

export const BASH_SIMPLE_APPROVAL_OPTIONS = [
  APPROVAL_OPTION_RUN_ONCE,
  APPROVAL_OPTION_EXPLAIN_COMMAND,
  APPROVAL_OPTION_VIEW_DETAILS,
  APPROVAL_OPTION_BLOCK,
] as const;

export const BASH_HIGH_RISK_APPROVAL_OPTIONS = [
  APPROVAL_OPTION_RUN_HIGH_RISK_ONCE,
  APPROVAL_OPTION_EXPLAIN_COMMAND,
  APPROVAL_OPTION_VIEW_DETAILS,
  APPROVAL_OPTION_BLOCK,
] as const;

const BASH_COMMAND_PREVIEW_CHARS = 1400;
const BASH_REASON_PREVIEW_CHARS = 900;
const DEFAULT_PROMPT_DISPLAY_WIDTH = 100;
const MIN_LONG_TOKEN_PREVIEW_CHARS = 72;

function longTokenLimit(displayWidth?: number) {
  const width =
    typeof displayWidth === "number" && Number.isFinite(displayWidth)
      ? displayWidth
      : DEFAULT_PROMPT_DISPLAY_WIDTH;

  // Account for select chrome + section indentation. This is intentionally
  // conservative because ui.select() receives a static prompt string and cannot
  // recompute on resize.
  return Math.max(MIN_LONG_TOKEN_PREVIEW_CHARS, Math.floor(width) - 24);
}

function shortenLongPreviewTokens(text: string, displayWidth?: number) {
  const limit = longTokenLimit(displayWidth);
  const pattern = new RegExp(`\\S{${limit + 1},}`, "g");

  return text.replace(pattern, (token) => {
    const marker = `...[${token.length - limit} chars omitted]...`;
    const available = Math.max(16, limit - marker.length);
    const head = Math.max(8, Math.ceil(available * 0.7));
    const tail = Math.max(4, available - head);
    return `${token.slice(0, head)}${marker}${token.slice(token.length - tail)}`;
  });
}

function lineLimit(displayWidth?: number) {
  const width =
    typeof displayWidth === "number" && Number.isFinite(displayWidth)
      ? displayWidth
      : DEFAULT_PROMPT_DISPLAY_WIDTH;

  // Extra room for ui.select chrome, section indentation and ANSI reset quirks.
  return Math.max(40, Math.floor(width) - 16);
}

function constrainPreviewLines(text: string, displayWidth?: number) {
  const limit = lineLimit(displayWidth);

  return text
    .split("\n")
    .map((line) => {
      if (visibleWidth(line) <= limit) return line;
      const marker = "...[line shortened; View details]";
      const target = Math.max(20, limit - visibleWidth(marker));
      return `${truncateToWidth(line, target)}${marker}`;
    })
    .join("\n");
}

function previewPromptText(
  text: string,
  maxChars: number,
  omittedLabel: string,
  displayWidth?: number,
) {
  const preview = text.length <= maxChars ? text : text.slice(0, maxChars);
  const safePreview = constrainPreviewLines(
    shortenLongPreviewTokens(preview, displayWidth),
    displayWidth,
  );
  if (text.length <= maxChars) return safePreview;

  const omitted = text.length - maxChars;
  return [
    safePreview,
    "",
    `[${omittedLabel} shortened for display: ${omitted} chars omitted; use \"View details\" to inspect all content]`,
  ].join("\n");
}

function previewCommand(command: string, displayWidth?: number) {
  return previewPromptText(
    command,
    BASH_COMMAND_PREVIEW_CHARS,
    "command",
    displayWidth,
  );
}

function previewReason(reason: string, displayWidth?: number) {
  return previewPromptText(reason, BASH_REASON_PREVIEW_CHARS, "reason", displayWidth);
}

function renderBashExplanationSection(
  explanation?: BashExplanationPromptData,
  displayWidth?: number,
) {
  if (!explanation) return "";

  const risksInline =
    explanation.risks.length > 0 ? explanation.risks.join("  ·  ") : "unknown";

  const lines = [
    `${gray("summary:")} ${previewReason(explanation.summary, displayWidth)}`,
    `${gray("impact:")} ${previewReason(explanation.impact, displayWidth)}`,
    `${gray("recommendation:")} ${explanation.recommendation}`,
    `${gray("risks:")} ${previewReason(risksInline, displayWidth)}`,
  ];

  if (explanation.flags && explanation.flags.length > 0) {
    lines.push(
      `${gray("flags:")} ${previewReason(explanation.flags.join(", "), displayWidth)}`,
    );
  }

  if (explanation.commandWasTruncated) {
    lines.push(dim("note: truncated command input (first 4000 chars)."));
  }

  return section("Explanation (AI)", lines.join("\n"));
}

export function bashSimplePrompt(
  command: string,
  reason?: string,
  explanation?: BashExplanationPromptData,
  displayWidth?: number,
) {
  const blocks = [
    `${gray("tool:")} bash`,
    section("Command", previewCommand(command, displayWidth)),
    reason ? section("Policy reason", previewReason(reason, displayWidth)) : "",
    explanation ? renderBashExplanationSection(explanation, displayWidth) : "",
    section("Decision", "Run this command once?"),
  ].filter((block) => block.length > 0);

  return blocks.join("\n\n");
}

export function bashHighRiskPrompt(
  command: string,
  reasons: string[],
  explanation?: BashExplanationPromptData,
  displayWidth?: number,
) {
  const blocks = [
    `${gray("tool:")} bash`,
    section("Command", previewCommand(command, displayWidth)),
    reasons.length > 0
      ? section("High-risk reasons", bullets(reasons, displayWidth))
      : section("High-risk reasons", `${dim("- unknown")}`),
    explanation ? renderBashExplanationSection(explanation, displayWidth) : "",
    section("Decision", "This command is high risk."),
  ].filter((block) => block.length > 0);

  return blocks.join("\n\n");
}

export function bashRunConfirmationPrompt() {
  return "Final confirmation required: type RUN to execute once.";
}

export function previewUnavailablePrompt(
  tool: string,
  reason: string,
  meta?: string,
) {
  return `Tool: ${tool}\n\nPreview unavailable: ${reason}${meta ? `\n\n${meta}` : ""}\n\nAllow execution?`;
}

export function previewUnavailableWithSourcePrompt(
  tool: string,
  source: string,
  errorMessage: string,
  meta?: string,
) {
  return `Tool: ${tool}\n\nPreview unavailable (${source}): ${errorMessage}${meta ? `\n\n${meta}` : ""}\n\nAllow execution?`;
}

export function diffViewedPrompt(tool: string, label: string) {
  return `Tool: ${tool}\n\nDiff viewed (${label}). Allow execution?`;
}

export function neovimUnavailablePrompt(tool: string, reason: string) {
  return `Tool: ${tool}\n\nReview in Neovim unavailable: ${reason}\n\nAllow execution?`;
}

export function neovimReviewNoChangesMessage(tool: string) {
  return `Tool: ${tool}\n\nReview in Neovim completed with no content changes.`;
}

export function neovimReviewChangedPrompt(tool: string) {
  return `Tool: ${tool}\n\nReview in Neovim found content changes. Choose what to do next.`;
}

export function unexpectedPreviewErrorPrompt(tool: string) {
  return `Tool: ${tool}\n\nPreview unavailable due to an unexpected error.\n\nAllow execution?`;
}
