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
import {
  openDiffEditor,
  openEditor,
  openEditorArgs,
} from "./pi-editor-lib/editor-open.mjs";
import { runEditorContext } from "./pi-editor-lib/workflow.mjs";

const USAGE = [
  "Usage:",
  "  pi-editor.mjs <pi-temp-file>",
  "  pi-editor.mjs --mode context <pi-temp-file>",
  "  pi-editor.mjs --mode plain [--no-wait] <editor-args...>",
  "  pi-editor.mjs --mode diff <old-file> <new-file> [-- <extra-args...>]",
].join("\n");

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
    if (!requestedMode || !["context", "plain", "diff"].includes(requestedMode)) {
      throw usageError(USAGE);
    }
    mode = requestedMode;
    args.splice(0, 2);
  }

  if (mode !== "plain" && args.includes("--no-wait")) {
    throw usageError(USAGE);
  }

  if (mode === "plain") {
    const normalizedArgs = args.map((arg) => String(arg ?? "")).filter(Boolean);
    const noWait = normalizedArgs.includes("--no-wait");
    const editorArgs = normalizedArgs.filter((arg) => arg !== "--no-wait");

    if (editorArgs.length < 1) {
      throw usageError(USAGE);
    }

    return {
      mode,
      noWait,
      editorArgs,
    };
  }

  if (mode === "diff") {
    const separatorIndex = args.indexOf("--");
    const positionalArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;

    if (positionalArgs.length !== 2) {
      throw usageError(USAGE);
    }

    const oldFile = String(positionalArgs[0] ?? "").trim();
    const newFile = String(positionalArgs[1] ?? "").trim();

    if (!oldFile || !newFile) {
      throw usageError(USAGE);
    }

    if (separatorIndex < 0 && args.length !== 2) {
      throw usageError(USAGE);
    }

    if (separatorIndex >= 0 && separatorIndex !== 2) {
      throw usageError(USAGE);
    }

    const extraArgs =
      separatorIndex >= 0
        ? args
            .slice(separatorIndex + 1)
            .map((arg) => String(arg ?? ""))
            .filter(Boolean)
        : [];

    return { mode, oldFile, newFile, extraArgs };
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
  const editorArgsInput = options.editorArgs;
  const resolveConfigImpl = options.resolveConfigImpl ?? resolveConfig;
  const openEditorImpl = options.openEditorImpl ?? openEditor;
  const openEditorArgsImpl = options.openEditorArgsImpl ?? openEditorArgs;
  const noWait = Boolean(options.noWait);

  const editorArgs = Array.isArray(editorArgsInput)
    ? editorArgsInput.map((arg) => String(arg ?? "")).filter(Boolean)
    : tempFile
      ? [String(tempFile)]
      : [];

  if (editorArgs.length < 1) {
    throw usageError(USAGE);
  }

  const config = await resolveConfigImpl(env, resolveCwd(env));

  if (editorArgs.length === 1) {
    return openEditorImpl(editorArgs[0], config, env, { noWait });
  }

  return openEditorArgsImpl(editorArgs, config, env, { noWait });
}

async function runDiffEditor(options = {}) {
  const env = options.env ?? process.env;
  const oldFileInput = options.oldFile;
  const newFileInput = options.newFile;
  const extraArgsInput = options.extraArgs;
  const resolveConfigImpl = options.resolveConfigImpl ?? resolveConfig;
  const openEditorArgsImpl = options.openEditorArgsImpl ?? openEditorArgs;
  const openDiffEditorImpl = options.openDiffEditorImpl ?? openDiffEditor;

  const oldFile = String(oldFileInput ?? "").trim();
  const newFile = String(newFileInput ?? "").trim();

  if (!oldFile || !newFile) {
    throw usageError(USAGE);
  }

  const extraArgs = Array.isArray(extraArgsInput)
    ? extraArgsInput.map((arg) => String(arg ?? "")).filter(Boolean)
    : [];

  const config = await resolveConfigImpl(env, resolveCwd(env));

  if (typeof openDiffEditorImpl === "function") {
    return openDiffEditorImpl(oldFile, newFile, extraArgs, config, env);
  }

  return openEditorArgsImpl(["-d", oldFile, newFile, ...extraArgs], config, env);
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

  const parsed = parseCliArgs(argv);

  if (parsed.mode === "plain") {
    return runPlainEditor({
      env,
      editorArgs: parsed.editorArgs,
      noWait: parsed.noWait,
      resolveConfigImpl: options.resolveConfigImpl,
      openEditorImpl: options.openEditorImpl,
      openEditorArgsImpl: options.openEditorArgsImpl,
    });
  }

  if (parsed.mode === "diff") {
    return runDiffEditor({
      env,
      oldFile: parsed.oldFile,
      newFile: parsed.newFile,
      extraArgs: parsed.extraArgs,
      resolveConfigImpl: options.resolveConfigImpl,
      openEditorArgsImpl: options.openEditorArgsImpl,
      openDiffEditorImpl: options.openDiffEditorImpl,
    });
  }

  return runContextEditor({
    env,
    tempFile: parsed.tempFile,
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
  runDiffEditor,
  runEditorContext,
  runPiEditor,
  runPlainEditor,
  selectBranch,
};
