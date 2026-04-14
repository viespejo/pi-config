export const APPROVAL_OPTION_YES = "Yes";
export const APPROVAL_OPTION_VIEW_DIFF = "View diff";
export const APPROVAL_OPTION_REVIEW_NVIM = "Review in Neovim";
export const APPROVAL_OPTION_YES_SESSION = "Yes, always this session";
export const APPROVAL_OPTION_NO = "No";

export const APPROVAL_OPTION_RUN_ONCE = "Run once";
export const APPROVAL_OPTION_RUN_HIGH_RISK_ONCE = "Run high-risk once";
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

export function bashSimplePrompt(command: string, reason?: string) {
  return `Tool: bash\n\nCommand:\n${command}${reason ? `\n\nReason: ${reason}` : ""}\n\nRun this command once?`;
}

export function bashHighRiskPrompt(command: string, reasons: string[]) {
  const details = reasons.length > 0 ? `\n\nHigh-risk reasons:\n- ${reasons.join("\n- ")}` : "";
  return `Tool: bash\n\nCommand:\n${command}${details}\n\nThis command is high risk.`;
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
