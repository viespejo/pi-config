import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildContext,
  buildWorkingFile as buildWorkingFileCore,
  extractPromptFromWorkingFile as extractPromptFromWorkingFileCore,
  normalizeEol,
  trimSingleTrailingNewline,
} from "./context-core.mjs";
import { MARKERS, resolveConfigDetailed } from "./config.mjs";
import { discoverSessionFileDetailed } from "./session-discovery.mjs";
import { entryId, parseJsonlSession, selectBranch } from "./session-core.mjs";
import { isNvrConnectionLostError, openEditor } from "./editor-open.mjs";

function resolveCwd(env) {
  return env.PI_EDITOR_CWD_HINT || env.PWD || process.cwd();
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ note: "unserializable-payload" });
  }
}

async function appendDebug(enabled, message, payload = undefined) {
  if (!enabled) return;

  try {
    const debugPath = path.join(
      os.homedir(),
      ".local",
      "state",
      "pi-editor",
      "debug.log",
    );
    const serialized = payload === undefined ? "" : ` ${safeJson(payload)}`;
    const line = `${new Date().toISOString()} ${message}${serialized}\n`;
    await fs.mkdir(path.dirname(debugPath), { recursive: true });
    await fs.appendFile(debugPath, line, "utf8");
  } catch {
    // Debug logging must never break editor flow.
  }
}

function buildWorkingFile(contextText, promptBase) {
  return buildWorkingFileCore(contextText, promptBase, MARKERS);
}

function extractPromptFromWorkingFile(content) {
  return extractPromptFromWorkingFileCore(content, MARKERS);
}

async function createWorkingPath(config, originalTempPath) {
  if (config.workingMode === "persistent") {
    const parent = path.dirname(originalTempPath);
    const base = path.basename(originalTempPath);
    return path.join(parent, `${base}.pi-editor-context.md`);
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-editor-context-"));
  return path.join(dir, "working.md");
}

async function runEditorContext(options) {
  const {
    tempFile,
    env = process.env,
    openEditorImpl = openEditor,
    fallbackEditorImpl = (fallbackPath, fallbackConfig, fallbackEnv) =>
      openEditorImpl(
        fallbackPath,
        { ...fallbackConfig, openMode: "nvim" },
        fallbackEnv,
      ),
    configOverrides = undefined,
  } = options;

  if (!tempFile) {
    throw new Error("Usage: pi-editor-context.mjs <pi-temp-file>");
  }

  const cwd = resolveCwd(env);
  const { config, meta: configMeta } = await resolveConfigDetailed(
    env,
    cwd,
    configOverrides,
  );

  let originalPrompt = "";
  let workingPath = "";
  let contextText = "";

  try {
    await appendDebug(config.debug, "config-resolved", {
      cwd,
      config,
      sourceByField: configMeta.sources,
      configPaths: {
        user: configMeta.userConfigPath,
        project: configMeta.projectConfigPath,
      },
    });

    await appendDebug(config.debug, "env-signals", {
      CLAUDECODE: env.CLAUDECODE,
      CLAUDE_CODE_ENTRYPOINT: env.CLAUDE_CODE_ENTRYPOINT,
      CLAUDE_PROJECT_DIR: env.CLAUDE_PROJECT_DIR,
      CLAUDE_SESSION_ID: env.CLAUDE_SESSION_ID,
      CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR,
      PI_CODING_AGENT_DIR: env.PI_CODING_AGENT_DIR,
      PI_EDITOR_CONTEXT_SESSION_SOURCE: env.PI_EDITOR_CONTEXT_SESSION_SOURCE,
      PI_EDITOR_SESSION_SOURCE: env.PI_EDITOR_SESSION_SOURCE,
      PI_EDITOR_SESSIONS_DIR: env.PI_EDITOR_SESSIONS_DIR,
      PWD: env.PWD,
      PI_EDITOR_CWD_HINT: env.PI_EDITOR_CWD_HINT,
    });

    const originalPromptRaw = await fs.readFile(tempFile, "utf8");
    originalPrompt = trimSingleTrailingNewline(normalizeEol(originalPromptRaw));

    const sessionDiscovery = await discoverSessionFileDetailed(
      config,
      env,
      cwd,
    );
    const sessionPath = sessionDiscovery.sessionPath;
    await appendDebug(config.debug, "session-discovery", sessionDiscovery);

    let selectedLeafId = "";
    let injectedCount = 0;
    let contextStats = {
      enabled: config.enabled,
      branchEntries: 0,
      messageEntries: 0,
      includedByRole: 0,
      skippedByRole: 0,
      skippedByAge: 0,
      skippedEmpty: 0,
      perMessageTruncated: 0,
      extractedMessages: 0,
      recentWindowSize: 0,
      maxCharsTruncated: false,
    };

    if (sessionPath && config.enabled) {
      const entries = await parseJsonlSession(sessionPath);
      const { selectedLeaf, branchEntries, leavesCount } =
        selectBranch(entries);
      selectedLeafId = entryId(selectedLeaf);
      await appendDebug(config.debug, "branch-selection", {
        selectedLeafId,
        leavesCount,
        branchEntries: branchEntries.length,
      });

      const context = buildContext(branchEntries, config);
      contextText = context.contextText;
      injectedCount = context.injectedCount;
      contextStats = context.stats;
    }

    await appendDebug(config.debug, "context-built", {
      sessionPath,
      selectedLeafId,
      injectedCount,
      contextChars: contextText.length,
      contextStats,
    });

    workingPath = await createWorkingPath(config, tempFile);
    await fs.mkdir(path.dirname(workingPath), { recursive: true });
    await fs.writeFile(
      workingPath,
      buildWorkingFile(contextText, originalPrompt),
      "utf8",
    );

    await appendDebug(config.debug, "editor-open", {
      workingPath,
      requestedMode: config.openMode,
      nvrWaitMode: "remote-wait-silent",
    });

    const editorDecision = await Promise.resolve(
      openEditorImpl(workingPath, config),
    );
    await appendDebug(config.debug, "editor-returned", {
      workingPath,
      requestedMode: config.openMode,
      nvrWaitMode: "remote-wait-silent",
      editorDecision: editorDecision ?? {
        requestedMode: config.openMode,
        effectiveMode: "custom-open-editor-impl",
      },
    });

    const edited = await fs.readFile(workingPath, "utf8");
    let promptOut = extractPromptFromWorkingFile(edited);

    if (config.emptyPolicy === "restore" && promptOut.trim().length === 0) {
      promptOut = originalPrompt;
    }

    await fs.writeFile(tempFile, promptOut, "utf8");
    await appendDebug(config.debug, "exported", {
      outputChars: promptOut.length,
      outputBytes: Buffer.byteLength(promptOut, "utf8"),
      inputPromptChars: originalPrompt.length,
      inputPromptBytes: Buffer.byteLength(originalPrompt, "utf8"),
      contextChars: contextText.length,
      contextBytes: Buffer.byteLength(contextText, "utf8"),
      contextExported: false,
    });

    if (config.workingMode === "temp") {
      await fs.rm(path.dirname(workingPath), { recursive: true, force: true });
    }

    return {
      status: "ok",
      config,
      selectedLeafId,
      injectedCount,
      contextChars: contextText.length,
    };
  } catch (error) {
    await appendDebug(config.debug, "error", {
      message: error instanceof Error ? error.message : String(error),
    });

    if (config.errorPolicy === "hard") {
      throw error;
    }

    const skipFallbackForConnectionLoss = isNvrConnectionLostError(error);

    if (skipFallbackForConnectionLoss) {
      await appendDebug(config.debug, "soft-skip-fallback", {
        reason: "nvr-connection-lost",
        action: "skip-fallback-editor-open",
      });
    } else {
      let hasWorkingPath =
        typeof workingPath === "string" &&
        workingPath.length > 0 &&
        (await fileExists(workingPath));

      if (!hasWorkingPath) {
        try {
          if (!workingPath) {
            workingPath = await createWorkingPath(config, tempFile);
          }
          await fs.mkdir(path.dirname(workingPath), { recursive: true });
          await fs.writeFile(
            workingPath,
            buildWorkingFile(contextText, originalPrompt),
            "utf8",
          );
          hasWorkingPath = true;
        } catch {
          // Keep temp-file fallback path if working-file recreation fails.
        }
      }

      const fallbackPath = hasWorkingPath ? workingPath : tempFile;

      await appendDebug(config.debug, "fallback-editor-open", {
        fallbackPath,
        fallbackType: hasWorkingPath ? "working-file" : "pi-temp-file",
      });

      try {
        await Promise.resolve(fallbackEditorImpl(fallbackPath, config, env));

        if (hasWorkingPath) {
          const edited = await fs.readFile(workingPath, "utf8");
          let promptOut = extractPromptFromWorkingFile(edited);

          if (
            config.emptyPolicy === "restore" &&
            promptOut.trim().length === 0
          ) {
            promptOut = originalPrompt;
          }

          await fs.writeFile(tempFile, promptOut, "utf8");
          await appendDebug(config.debug, "exported-fallback", {
            outputChars: promptOut.length,
            outputBytes: Buffer.byteLength(promptOut, "utf8"),
            inputPromptChars: originalPrompt.length,
            inputPromptBytes: Buffer.byteLength(originalPrompt, "utf8"),
            contextExported: false,
          });

          if (config.workingMode === "temp") {
            await fs.rm(path.dirname(workingPath), {
              recursive: true,
              force: true,
            });
          }
        }
      } catch {
        // Last-resort: never hard fail in soft mode.
      }
    }

    return {
      status: "soft-recovered",
      config,
      selectedLeafId: "",
      injectedCount: 0,
      contextChars: 0,
    };
  }
}

export { runEditorContext };
