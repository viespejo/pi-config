export function summarizeEditsForPrompt(edits: any, filePath?: string) {
  if (!Array.isArray(edits)) return "Edits: (unknown format)";

  let inserts = 0,
    deletes = 0,
    replaces = 0;
  let totalOld = 0,
    totalNew = 0;
  const examples: string[] = [];

  for (let i = 0; i < edits.length; i++) {
    const e = edits[i] ?? {};
    const newText =
      typeof e.newText === "string"
        ? e.newText
        : typeof e.text === "string"
          ? e.text
          : "";
    const oldText =
      typeof e.oldText === "string"
        ? e.oldText
        : typeof e.original === "string"
          ? e.original
          : "";
    const hasOld = oldText.length > 0;
    const hasNew = newText.length > 0;

    if (hasOld && hasNew) replaces++;
    else if (!hasOld && hasNew) inserts++;
    else if (hasOld && !hasNew) deletes++;
    else replaces++; // fallback

    totalOld += oldText.length;
    totalNew += newText.length;

    if (examples.length < 3) {
      const rangeInfo =
        e.start !== undefined || e.end !== undefined
          ? `range: ${String(e.start ?? "?")}-${String(e.end ?? "?")}`
          : e.range
            ? `range: ${JSON.stringify(e.range)}`
            : "";
      examples.push(
        `- Edit ${i + 1}: type=${hasOld ? (hasNew ? "replace" : "delete") : "insert"}, oldChars=${oldText.length}, newChars=${newText.length}${rangeInfo ? `, ${rangeInfo}` : ""}`,
      );
    }
  }

  const summaryLines = [
    filePath ? `Path: ${String(filePath)}` : undefined,
    `Total edits: ${edits.length} (inserts=${inserts}, deletes=${deletes}, replaces=${replaces})`,
    `Total old chars: ${totalOld}, total new chars: ${totalNew}`,
    examples.length ? `Examples:\n${examples.join("\n")}` : undefined,
    "Note: detailed preview unavailable. Showing metadata only.",
  ].filter(Boolean) as string[];

  return summaryLines.join("\n");
}
