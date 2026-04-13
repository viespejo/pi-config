export const APPROVAL_OPTION_YES = "Yes";
export const APPROVAL_OPTION_VIEW_DIFF = "View diff";
export const APPROVAL_OPTION_YES_SESSION = "Yes, always this session";
export const APPROVAL_OPTION_NO = "No";

export const DIFF_APPROVAL_OPTIONS = [
  APPROVAL_OPTION_YES,
  APPROVAL_OPTION_VIEW_DIFF,
  APPROVAL_OPTION_YES_SESSION,
  APPROVAL_OPTION_NO,
] as const;

export const DENY_REASON_LABEL = "Why was this denied? (optional)";
export const DENY_REASON_PLACEHOLDER = "Reason for the LLM";

export function allowExecutionPrompt(tool: string) {
  return `Tool: ${tool}\n\nAllow execution?`;
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

export function unexpectedPreviewErrorPrompt(tool: string) {
  return `Tool: ${tool}\n\nPreview unavailable due to an unexpected error.\n\nAllow execution?`;
}
