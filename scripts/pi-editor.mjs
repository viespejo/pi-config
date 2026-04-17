#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildContext,
  buildWorkingFile as buildWorkingFileCore,
  extractPromptFromWorkingFile as extractPromptFromWorkingFileCore,
} from "./pi-editor-lib/context-core.mjs";
import {
  DEFAULTS,
  MARKERS,
  resolveConfig,
} from "./pi-editor-lib/config.mjs";
import { discoverSessionFile } from "./pi-editor-lib/session-discovery.mjs";
import {
  extractMessageText,
  parseJsonlSession,
  selectBranch,
} from "./pi-editor-lib/session-core.mjs";
import { openEditor } from "./pi-editor-lib/editor-open.mjs";
import { runEditorContext } from "./pi-editor-lib/workflow.mjs";

const USAGE = "Usage: pi-editor.mjs [--mode context|plain] <pi-temp-file>";

function usageError(message = USAGE) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

function resolveCwd(env) {
  return env.PI_EDITOR_CWD_HINT || env.PWD || process.cwd();
}

function parseCliArgs(argv) {
  const args = [...argv];
  let mode = "context";

  if (args[0] === "--mode") {
    const requestedMode = String(args[1] ?? "").trim();
    if (!requestedMode || !["context", "plain"].includes(requestedMode)) {
      throw usageError(USAGE);
    }
    mode = requestedMode;
    args.splice(0, 2);
  }

  if (args.length !== 1) {
    throw usageError(USAGE);
  }

  const tempFile = String(args[0] ?? "").trim();
  if (!tempFile) {
    throw usageError(USAGE);
  }

  return { mode, tempFile };
}

function buildWorkingFile(contextText, promptBase) {
  return buildWorkingFileCore(contextText, promptBase, MARKERS);
}

function extractPromptFromWorkingFile(content) {
  return extractPromptFromWorkingFileCore(content, MARKERS);
}

async function runPlainEditor(options = {}) {
  const env = options.env ?? process.env;
  const tempFile = options.tempFile;
  const resolveConfigImpl = options.resolveConfigImpl ?? resolveConfig;
  const openEditorImpl = options.openEditorImpl ?? openEditor;

  if (!tempFile) {
    throw usageError(USAGE);
  }

  const config = await resolveConfigImpl(env, resolveCwd(env));
  return openEditorImpl(tempFile, config, env);
}

async function runContextEditor(options = {}) {
  const env = options.env ?? process.env;
  const tempFile = options.tempFile;
  const runEditorContextImpl = options.runEditorContextImpl ?? runEditorContext;

  if (!tempFile) {
    throw usageError(USAGE);
  }

  return runEditorContextImpl({ tempFile, env });
}

async function runPiEditor(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;

  const { mode, tempFile } = parseCliArgs(argv);

  if (mode === "plain") {
    return runPlainEditor({
      env,
      tempFile,
      resolveConfigImpl: options.resolveConfigImpl,
      openEditorImpl: options.openEditorImpl,
    });
  }

  return runContextEditor({
    env,
    tempFile,
    runEditorContextImpl: options.runEditorContextImpl,
  });
}

async function main() {
  try {
    await runPiEditor();
  } catch (error) {
    const exitCode = Number(error?.exitCode ?? 1);
    if (exitCode === 2) {
      console.error(USAGE);
      process.exit(2);
    }

    console.error(
      `[pi-editor] ${error instanceof Error ? error.message : String(error)}`,
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
  USAGE,
  buildContext,
  buildWorkingFile,
  discoverSessionFile,
  extractMessageText,
  extractPromptFromWorkingFile,
  parseCliArgs,
  parseJsonlSession,
  resolveConfig,
  runContextEditor,
  runEditorContext,
  runPiEditor,
  runPlainEditor,
  selectBranch,
};
