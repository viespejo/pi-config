#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildContext,
  buildWorkingFile as buildWorkingFileCore,
  extractPromptFromWorkingFile as extractPromptFromWorkingFileCore,
} from "./pi-editor-context-lib/context-core.mjs";
import {
  DEFAULTS,
  MARKERS,
  resolveConfig,
} from "./pi-editor-context-lib/config.mjs";
import { discoverSessionFile } from "./pi-editor-context-lib/session-discovery.mjs";
import {
  extractMessageText,
  parseJsonlSession,
  selectBranch,
} from "./pi-editor-context-lib/session-core.mjs";
import { runEditorContext } from "./pi-editor-context-lib/workflow.mjs";

function buildWorkingFile(contextText, promptBase) {
  return buildWorkingFileCore(contextText, promptBase, MARKERS);
}

function extractPromptFromWorkingFile(content) {
  return extractPromptFromWorkingFileCore(content, MARKERS);
}

async function main() {
  const tempFile = process.argv[2];
  if (!tempFile) {
    console.error("Usage: pi-editor-context.mjs <pi-temp-file>");
    process.exit(2);
  }

  try {
    await runEditorContext({ tempFile });
  } catch (error) {
    console.error(
      `[pi-editor-context] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  await main();
}

export {
  DEFAULTS,
  MARKERS,
  buildContext,
  buildWorkingFile,
  discoverSessionFile,
  extractPromptFromWorkingFile,
  extractMessageText,
  parseJsonlSession,
  resolveConfig,
  runEditorContext,
  selectBranch,
};
