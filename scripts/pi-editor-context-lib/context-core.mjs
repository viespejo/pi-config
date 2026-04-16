function normalizeEol(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function trimSingleTrailingNewline(text) {
  if (!text) return "";
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function stripAnsiAndControl(text) {
  const noAnsi = text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
  return noAnsi.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
    "",
  );
}

function truncate(text, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return "";
  if (text.length <= limit) return text;
  if (limit <= 1) return "…";
  return `${text.slice(0, limit - 1)}…`;
}

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

function buildContext(branchEntries, config) {
  if (!config.enabled) {
    return {
      contextText: "",
      injectedCount: 0,
      stats: {
        enabled: false,
        branchEntries: branchEntries.length,
        messageEntries: 0,
        includedByRole: 0,
        skippedByRole: 0,
        skippedByAge: 0,
        skippedEmpty: 0,
        perMessageTruncated: 0,
        extractedMessages: 0,
        recentWindowSize: 0,
        maxCharsTruncated: false,
      },
    };
  }

  const cutoff =
    config.maxAgeDays > 0
      ? Date.now() - config.maxAgeDays * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;

  const extracted = [];
  let messageEntries = 0;
  let includedByRole = 0;
  let skippedByRole = 0;
  let skippedByAge = 0;
  let skippedEmpty = 0;
  let perMessageTruncated = 0;

  for (const entry of branchEntries) {
    if (entry?.type !== "message") continue;
    messageEntries += 1;

    const role = entry?.message?.role;
    if (role !== "user" && role !== "assistant") {
      skippedByRole += 1;
      continue;
    }
    if (role === "assistant" && !config.includeAssistant) {
      skippedByRole += 1;
      continue;
    }
    includedByRole += 1;

    const ts = getEntryTimestamp(entry);
    if (ts < cutoff) {
      skippedByAge += 1;
      continue;
    }

    const rawText = extractMessageText(entry.message, role);
    if (!rawText) {
      skippedEmpty += 1;
      continue;
    }

    const sanitized = stripAnsiAndControl(normalizeEol(rawText));
    if (sanitized.length > config.maxPerMessage) {
      perMessageTruncated += 1;
    }

    const bounded = truncate(sanitized, config.maxPerMessage).trim();
    if (!bounded) {
      skippedEmpty += 1;
      continue;
    }

    const prefix = role === "user" ? "U" : "A";
    const timeTag =
      config.showTime && ts > 0 ? ` [${new Date(ts).toISOString()}]` : "";
    const lines = bounded.split("\n");
    const formatted = [`${prefix}${timeTag}: ${lines[0]}`]
      .concat(lines.slice(1).map((line) => `   ${line}`))
      .join("\n");

    extracted.push(formatted);
  }

  const recent = extracted.slice(-config.messages);
  const selected = [];
  let usedChars = 0;
  let maxCharsTruncated = false;

  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const segment = recent[i];
    if (usedChars + segment.length <= config.maxChars) {
      selected.unshift(segment);
      usedChars += segment.length;
      continue;
    }

    maxCharsTruncated = true;
    const remaining = config.maxChars - usedChars;
    if (selected.length === 0 && remaining > 1) {
      selected.unshift(`${segment.slice(0, remaining - 1)}…`);
      usedChars = config.maxChars;
    }
    break;
  }

  return {
    contextText: selected.join("\n\n"),
    injectedCount: selected.length,
    stats: {
      enabled: true,
      branchEntries: branchEntries.length,
      messageEntries,
      includedByRole,
      skippedByRole,
      skippedByAge,
      skippedEmpty,
      perMessageTruncated,
      extractedMessages: extracted.length,
      recentWindowSize: recent.length,
      maxCharsTruncated,
    },
  };
}

function buildWorkingFile(contextText, promptBase, markers) {
  const effectiveMarkers = markers ?? {
    contextStart: "<!-- PI_CONTEXT_START -->",
    contextEnd: "<!-- PI_CONTEXT_END -->",
    promptStart: "<!-- PI_PROMPT_START -->",
  };

  const parts = [
    effectiveMarkers.contextStart,
    "Note: Context text below is not exported. Do not remove or modify PI markers, especially PI_PROMPT_START.",
    contextText,
    effectiveMarkers.contextEnd,
    "",
    effectiveMarkers.promptStart,
    promptBase,
  ];
  return `${parts.join("\n")}\n`;
}

function extractPromptFromWorkingFile(content, markers) {
  const effectiveMarkers = markers ?? {
    contextStart: "<!-- PI_CONTEXT_START -->",
    contextEnd: "<!-- PI_CONTEXT_END -->",
    promptStart: "<!-- PI_PROMPT_START -->",
  };

  const normalized = normalizeEol(content);
  const index = normalized.indexOf(effectiveMarkers.promptStart);
  if (index < 0) {
    return trimSingleTrailingNewline(normalized);
  }

  let prompt = normalized.slice(index + effectiveMarkers.promptStart.length);
  if (prompt.startsWith("\n")) prompt = prompt.slice(1);
  return trimSingleTrailingNewline(prompt);
}

export {
  buildContext,
  buildWorkingFile,
  extractPromptFromWorkingFile,
  normalizeEol,
  trimSingleTrailingNewline,
};
