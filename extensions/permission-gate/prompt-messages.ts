export const APPROVAL_OPTION_YES = "Yes";
export const APPROVAL_OPTION_VIEW_DIFF = "View diff";
export const APPROVAL_OPTION_REVIEW_NVIM = "Review in Neovim";
export const APPROVAL_OPTION_YES_SESSION = "Yes, always this session";
export const APPROVAL_OPTION_NO = "No";

export const APPROVAL_OPTION_RUN_ONCE = "Run once";
export const APPROVAL_OPTION_RUN_HIGH_RISK_ONCE = "Run high-risk once";
export const APPROVAL_OPTION_EXPLAIN_COMMAND = "Explain command";
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

export function allowExecutionPrompt(tool: string) {
  return `Tool: ${tool}\n\nAllow execution?`;
}

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

function bullets(items: string[]) {
  if (items.length === 0) return `${dim("- unknown")}`;
  return items.map((item) => `${dim("- ")}${item}`).join("\n");
}

export const BASH_SIMPLE_APPROVAL_OPTIONS = [
  APPROVAL_OPTION_RUN_ONCE,
  APPROVAL_OPTION_EXPLAIN_COMMAND,
  APPROVAL_OPTION_BLOCK,
] as const;

export const BASH_HIGH_RISK_APPROVAL_OPTIONS = [
  APPROVAL_OPTION_RUN_HIGH_RISK_ONCE,
  APPROVAL_OPTION_EXPLAIN_COMMAND,
  APPROVAL_OPTION_BLOCK,
] as const;

function renderBashExplanationSection(explanation?: BashExplanationPromptData) {
  if (!explanation) return "";

  const risksInline =
    explanation.risks.length > 0 ? explanation.risks.join("  ·  ") : "unknown";

  const lines = [
    `${gray("summary:")} ${explanation.summary}`,
    `${gray("impact:")} ${explanation.impact}`,
    `${gray("recommendation:")} ${explanation.recommendation}`,
    `${gray("risks:")} ${risksInline}`,
  ];

  if (explanation.flags && explanation.flags.length > 0) {
    lines.push(`${gray("flags:")} ${explanation.flags.join(", ")}`);
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
) {
  const blocks = [
    `${gray("tool:")} bash`,
    section("Command", command),
    reason ? section("Policy reason", reason) : "",
    explanation ? renderBashExplanationSection(explanation) : "",
    section("Decision", "Run this command once?"),
  ].filter((block) => block.length > 0);

  return blocks.join("\n\n");
}

export function bashHighRiskPrompt(
  command: string,
  reasons: string[],
  explanation?: BashExplanationPromptData,
) {
  const blocks = [
    `${gray("tool:")} bash`,
    section("Command", command),
    reasons.length > 0
      ? section("High-risk reasons", bullets(reasons))
      : section("High-risk reasons", `${dim("- unknown")}`),
    explanation ? renderBashExplanationSection(explanation) : "",
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
