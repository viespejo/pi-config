import { promises as fs } from "node:fs";

function parseTimestampMs(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim().length <= 13) {
    return numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getEntryTimestamp(entry) {
  return (
    parseTimestampMs(entry?.timestamp) ||
    parseTimestampMs(entry?.message?.timestamp) ||
    parseTimestampMs(entry?.createdAt) ||
    0
  );
}

function entryId(entry) {
  if (typeof entry?.id === "string") return entry.id;
  if (typeof entry?.uuid === "string") return entry.uuid;
  return "";
}

function entryParentId(entry) {
  if (typeof entry?.parentId === "string") return entry.parentId;
  if (typeof entry?.parentUuid === "string") return entry.parentUuid;
  return "";
}

function extractTextFromBlock(block) {
  if (!block) return "";
  if (typeof block === "string") return block;
  if (typeof block.text === "string") return block.text;
  if (typeof block.value === "string") return block.value;
  return "";
}

function extractMessageText(message, role) {
  if (!message || typeof message !== "object") return "";

  if (typeof message.text === "string") return message.text;
  if (typeof message.content === "string") return message.content;

  if (!Array.isArray(message.content)) return "";

  const visibleAssistantTypes = new Set(["text", "output_text"]);
  const visibleUserTypes = new Set(["text", "input_text", "output_text"]);
  const visibleTypes =
    role === "assistant" ? visibleAssistantTypes : visibleUserTypes;

  const chunks = [];
  for (const block of message.content) {
    if (typeof block === "string") {
      chunks.push(block);
      continue;
    }

    if (!block || typeof block !== "object") continue;
    const blockType = typeof block.type === "string" ? block.type : "";
    if (blockType && !visibleTypes.has(blockType)) continue;

    const text = extractTextFromBlock(block);
    if (text) chunks.push(text);
  }

  return chunks.join("\n").trim();
}

async function parseJsonlSession(sessionPath) {
  const raw = await fs.readFile(sessionPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const entries = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL at line ${i + 1}`);
    }

    entries.push({ ...parsed, __lineIndex: i });
  }

  return entries;
}

function selectBranch(entries) {
  const idMap = new Map();
  const parentRefs = new Set();

  for (const entry of entries) {
    const id = entryId(entry);
    if (!id) continue;
    idMap.set(id, entry);

    const parent = entryParentId(entry);
    if (parent) parentRefs.add(parent);
  }

  const leaves = [...idMap.values()].filter(
    (entry) => !parentRefs.has(entryId(entry)),
  );
  if (leaves.length === 0) {
    return { selectedLeaf: null, branchEntries: [], leavesCount: 0 };
  }

  leaves.sort((a, b) => {
    const ts = getEntryTimestamp(a) - getEntryTimestamp(b);
    if (ts !== 0) return ts;
    return (a.__lineIndex ?? 0) - (b.__lineIndex ?? 0);
  });

  const selectedLeaf = leaves[leaves.length - 1];
  const branchEntries = [];
  const seen = new Set();
  let cursor = selectedLeaf;

  while (cursor) {
    const id = entryId(cursor);
    if (!id || seen.has(id)) break;
    seen.add(id);
    branchEntries.push(cursor);

    const parent = entryParentId(cursor);
    if (!parent) break;
    cursor = idMap.get(parent);
  }

  branchEntries.reverse();
  return { selectedLeaf, branchEntries, leavesCount: leaves.length };
}

export {
  entryId,
  extractMessageText,
  getEntryTimestamp,
  parseJsonlSession,
  selectBranch,
};
