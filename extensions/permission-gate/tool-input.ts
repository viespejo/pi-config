export function extractPathFromInput(input: any): string | undefined {
  return typeof input?.path === "string"
    ? input.path
    : typeof input?.file_path === "string"
      ? input.file_path
      : undefined;
}

export function extractEditInput(input: any): {
  path?: string;
  edits?: any[];
} {
  const path = extractPathFromInput(input);
  const edits = Array.isArray(input?.edits) ? input.edits : undefined;
  return { path, edits };
}

export function extractWriteInput(input: any): {
  path?: string;
  content?: string;
} {
  const path = extractPathFromInput(input);
  const content =
    typeof input?.content === "string"
      ? input.content
      : typeof input?.text === "string"
        ? input.text
        : undefined;
  return { path, content };
}
