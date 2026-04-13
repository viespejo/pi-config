export const ALWAYS_ALLOW_TOOLS = new Set<string>([
  "read",
  "ls",
  "grep",
  "find",
]);

export function isAlwaysAllowedTool(tool: string) {
  return ALWAYS_ALLOW_TOOLS.has(tool);
}

export function supportsSessionAllow(tool: string) {
  return tool !== "bash";
}

export function shouldBypassPromptForSession(
  tool: string,
  sessionAllow: Set<string>,
) {
  return supportsSessionAllow(tool) && sessionAllow.has(tool);
}

export function defaultOptionsForTool(tool: string) {
  return tool === "bash"
    ? ["Yes", "No"]
    : ["Yes", "Yes, always this session", "No"];
}
