import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

function commandAvailable(command) {
  const probe = spawnSync("bash", [
    "-lc",
    `command -v ${command} >/dev/null 2>&1`,
  ]);
  return probe.status === 0;
}

function runEditorCommand(command, args, options = {}) {
  const { captureOutput = false } = options;
  const child = captureOutput
    ? spawnSync(command, args, { encoding: "utf8" })
    : spawnSync(command, args, { stdio: "inherit", encoding: "utf8" });

  if (child.error) throw child.error;

  if (child.status !== 0) {
    const details = [];
    const stderr = String(child.stderr ?? "").trim();
    const stdout = String(child.stdout ?? "").trim();
    if (stderr) details.push(`stderr=${stderr}`);
    if (stdout) details.push(`stdout=${stdout}`);
    const suffix = details.length > 0 ? ` (${details.join(" | ")})` : "";
    throw new Error(`${command} exited with status ${child.status}${suffix}`);
  }
}

function listNvrServers() {
  const probe = spawnSync("nvr", ["--serverlist"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return [];

  return String(probe.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function readTmuxPaneOption(ownerPane, optionName, env = process.env) {
  if (!ownerPane) {
    return {
      value: "",
      status: "owner-pane-missing",
      detail: "PI_EDITOR_OWNER_PANE is empty",
    };
  }

  if (!commandAvailable("tmux")) {
    return {
      value: "",
      status: "tmux-unavailable",
      detail: "tmux is not available in PATH",
    };
  }

  if (String(env.TMUX ?? "").trim().length === 0) {
    return {
      value: "",
      status: "tmux-client-unavailable",
      detail: "TMUX environment is missing for pane option query",
    };
  }

  const probe = spawnSync(
    "tmux",
    ["show-options", "-p", "-v", "-t", ownerPane, optionName],
    { encoding: "utf8" },
  );

  if (probe.error || probe.status !== 0) {
    return {
      value: "",
      status: "pane-option-read-failed",
      detail: String(
        probe.stderr ?? probe.error?.message ?? "unknown error",
      ).trim(),
    };
  }

  const value = String(probe.stdout ?? "").trim();
  if (!value) {
    return {
      value: "",
      status: "pane-option-empty",
      detail: `${optionName} is empty for pane ${ownerPane}`,
    };
  }

  return {
    value,
    status: "ok",
    detail: "resolved from tmux pane option",
  };
}

function ownerStateFilePath(ownerKey) {
  const digest = createHash("sha256").update(ownerKey).digest("hex");
  return path.join(
    os.homedir(),
    ".local",
    "state",
    "pi-editor",
    "servers",
    `${digest}.json`,
  );
}

function ownerKeyCandidates(ownerKey) {
  const key = String(ownerKey ?? "").trim();
  if (!key) return [];

  const out = [key];

  if (key.startsWith("pid:")) {
    out.push(key.slice(4));
  } else if (/^\d+$/.test(key)) {
    out.push(`pid:${key}`);
  }

  return Array.from(new Set(out.filter(Boolean)));
}

function readOwnerStateFile(ownerKey) {
  const candidates = ownerKeyCandidates(ownerKey);
  if (candidates.length === 0) {
    return {
      value: "",
      status: "owner-key-missing",
      detail: "PI_EDITOR_OWNER_KEY is empty",
      stateFilePath: "",
      matchedOwnerKey: "",
    };
  }

  let lastMissingPath = "";

  for (const candidateKey of candidates) {
    const stateFilePath = ownerStateFilePath(candidateKey);
    try {
      const raw = readFileSync(stateFilePath, "utf8");
      const parsed = JSON.parse(raw);
      const value = String(parsed?.server ?? "").trim();

      if (!value) {
        return {
          value: "",
          status: "state-file-empty",
          detail: "state file has no server field",
          stateFilePath,
          matchedOwnerKey: candidateKey,
        };
      }

      return {
        value,
        status: candidateKey === candidates[0] ? "ok" : "ok-compat-owner-key",
        detail:
          candidateKey === candidates[0]
            ? "resolved from owner-key state file"
            : `resolved from compatible owner-key format (${candidateKey})`,
        stateFilePath,
        matchedOwnerKey: candidateKey,
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        lastMissingPath = stateFilePath;
        continue;
      }

      return {
        value: "",
        status: "state-file-read-failed",
        detail: error instanceof Error ? error.message : String(error),
        stateFilePath,
        matchedOwnerKey: candidateKey,
      };
    }
  }

  return {
    value: "",
    status: "state-file-missing",
    detail: `owner-key state file not found for candidates: ${candidates.join(", ")}`,
    stateFilePath: lastMissingPath,
    matchedOwnerKey: "",
  };
}

function resolveNvrTargetServer(env = process.env) {
  const availableServers = listNvrServers();
  const availableSet = new Set(availableServers);

  const ownerPane = String(env.PI_EDITOR_OWNER_PANE ?? "").trim();
  const paneOptionName = "@pi_editor_nvr_server";
  const paneLookup = readTmuxPaneOption(ownerPane, paneOptionName, env);

  const ownerKey = String(env.PI_EDITOR_OWNER_KEY ?? "").trim();
  const ownerStateLookup = readOwnerStateFile(ownerKey);

  const rawCandidates = [
    {
      value: paneLookup.value,
      source: `tmux-pane-option:${paneOptionName}`,
    },
    {
      value: ownerStateLookup.value,
      source: "state-file:PI_EDITOR_OWNER_KEY",
    },
    { value: env.NVIM, source: "env:NVIM" },
    {
      value: env.NVIM_LISTEN_ADDRESS,
      source: "env:NVIM_LISTEN_ADDRESS",
    },
  ];

  const candidateServers = [];
  const seen = new Set();
  for (const candidate of rawCandidates) {
    const value = String(candidate.value ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    candidateServers.push({ value, source: candidate.source });
  }

  const matched = candidateServers.find((entry) =>
    availableSet.has(entry.value),
  );

  return {
    hasTarget: Boolean(matched),
    targetServer: matched?.value ?? "",
    targetSource: matched?.source ?? "none",
    availableServers,
    candidateServers,
    ownerPane,
    paneOptionName,
    paneOptionStatus: paneLookup.status,
    paneOptionDetail: paneLookup.detail,
    ownerKey,
    ownerStateMatchedOwnerKey: ownerStateLookup.matchedOwnerKey,
    ownerStateFilePath: ownerStateLookup.stateFilePath,
    ownerStateStatus: ownerStateLookup.status,
    ownerStateDetail: ownerStateLookup.detail,
  };
}

function isNvrConnectionLostError(error) {
  const message = String(
    error instanceof Error ? error.message : error,
  ).toLowerCase();
  return message.includes("connection_lost") || message.includes("eoferror");
}

const NVR_WAIT_ARG = "--remote-wait-silent";
const NVR_NOWAIT_ARG = "--remote-silent";
const NVR_PRE_OPEN_ARGS = ["-cc", "split"];
const FOLD_LUA_CMD =
  "lua local marker='<!-- PI_PROMPT_START -->'; local l=vim.fn.search('\\\\V'..marker,'nw'); vim.cmd('silent! normal! zE'); if l>0 then vim.wo.foldmethod='manual'; vim.wo.foldenable=true; vim.cmd(('1,%dfold'):format(l)); pcall(vim.api.nvim_win_set_cursor,0,{l+1,0}); vim.cmd('normal! zt'); end; local last_line=vim.fn.line('$'); local last_col=math.max(vim.fn.col({last_line,'$'})-1,0); pcall(vim.api.nvim_win_set_cursor,0,{last_line,last_col})";
const NVR_REMOTE_COMMANDS = ["+setlocal bufhidden=delete", `+${FOLD_LUA_CMD}`];
const NVIM_INIT_ARGS = ["-c", "setlocal bufhidden=delete", "-c", FOLD_LUA_CMD];

function makeNvrArgs(targetServer, filePath, options = {}) {
  const waitArg = options.noWait ? NVR_NOWAIT_ARG : NVR_WAIT_ARG;

  return [
    "--nostart",
    "--servername",
    targetServer,
    ...NVR_PRE_OPEN_ARGS,
    waitArg,
    ...NVR_REMOTE_COMMANDS,
    filePath,
  ];
}

function parseDiffArgs(editorArgs) {
  if (!Array.isArray(editorArgs)) {
    return null;
  }

  const diffIndex = editorArgs.indexOf("-d");
  if (diffIndex < 0) {
    return null;
  }

  const oldFile = editorArgs[diffIndex + 1];
  const newFile = editorArgs[diffIndex + 2];
  if (!oldFile || !newFile) {
    return null;
  }

  return {
    diffIndex,
    oldFile,
    newFile,
    before: editorArgs.slice(0, diffIndex),
    after: editorArgs.slice(diffIndex + 3),
  };
}

function escapeVimString(value) {
  return String(value).replace(/'/g, "''");
}

function isDiffEditorArgs(editorArgs) {
  return parseDiffArgs(editorArgs) !== null;
}

function withStandaloneDiffUiCommands(editorArgs) {
  const diff = parseDiffArgs(editorArgs);
  if (!diff) {
    return [...editorArgs];
  }

  const args = [...editorArgs];
  args.push("-c", "wincmd h | setlocal readonly nomodifiable | wincmd l");
  args.push("-c", "stopinsert");
  args.push("-c", "wincmd l");
  args.push("-c", "silent! normal! ]c");
  args.push("-c", "normal! zz");
  args.push("-c", "autocmd QuitPre * qall");
  return args;
}

function buildNvrPassthroughEditorArgs(editorArgs) {
  const diff = parseDiffArgs(editorArgs);
  if (!diff) {
    return [...editorArgs];
  }

  const escapedOldPath = escapeVimString(diff.oldFile);
  const escapedNewPath = escapeVimString(diff.newFile);
  const openVerticalDiffCmd =
    `execute 'leftabove vert diffsplit ' . fnameescape('${escapedOldPath}')`;
  const readonlyOldWindowCmd =
    "windo if fnamemodify(expand('%:p'), ':p') ==# fnamemodify('" +
    escapedOldPath +
    "', ':p') | setlocal readonly nomodifiable | else | setlocal noreadonly modifiable | endif";
  const setupWindowsCmd =
    "wincmd h | setlocal bufhidden=wipe | diffthis | wincmd l | setlocal bufhidden=wipe | diffthis";
  const closeOldOnNewLeaveCmd =
    "autocmd BufWinLeave <buffer> ++once let bnr = bufnr(fnamemodify('" +
    escapedOldPath +
    "', ':p')) | if bnr > 0 | execute 'silent! bwipeout ' . bnr | endif";
  const closeNewOnOldLeaveCmd =
    "wincmd h | autocmd BufWinLeave <buffer> ++once let bnr = bufnr(fnamemodify('" +
    escapedNewPath +
    "', ':p')) | if bnr > 0 | execute 'silent! bwipeout ' . bnr | endif | wincmd l";

  return [
    ...diff.before,
    diff.newFile,
    ...diff.after,
    "-c",
    openVerticalDiffCmd,
    "-c",
    readonlyOldWindowCmd,
    "-c",
    setupWindowsCmd,
    "-c",
    closeOldOnNewLeaveCmd,
    "-c",
    closeNewOnOldLeaveCmd,
    "-c",
    "stopinsert",
    "-c",
    "wincmd l",
    "-c",
    "silent! normal! ]c",
    "-c",
    "normal! zz",
  ];
}

function makeNvrPassthroughArgs(targetServer, editorArgs, options = {}) {
  const nvrEditorArgs = buildNvrPassthroughEditorArgs(editorArgs);
  const waitArg =
    isDiffEditorArgs(editorArgs) || options.noWait ? NVR_NOWAIT_ARG : NVR_WAIT_ARG;

  return [
    "--nostart",
    "--servername",
    targetServer,
    ...NVR_PRE_OPEN_ARGS,
    waitArg,
    ...nvrEditorArgs,
  ];
}

function makeNvrRoutingMetadata(nvrResolution) {
  return {
    nvrServerAvailable: Boolean(nvrResolution.hasTarget),
    nvrTargetServer: nvrResolution.targetServer,
    nvrServerSource: nvrResolution.targetSource,
    availableServers: nvrResolution.availableServers,
    candidateServers: nvrResolution.candidateServers,
    ownerPane: nvrResolution.ownerPane,
    paneOptionName: nvrResolution.paneOptionName,
    paneOptionStatus: nvrResolution.paneOptionStatus,
    paneOptionDetail: nvrResolution.paneOptionDetail,
  };
}

function makeNvrRetryMetadata(firstError, retryResolution, initialResolution) {
  return {
    attempted: true,
    reason: "connection-lost",
    firstError:
      firstError instanceof Error ? firstError.message : String(firstError),
    targetChanged:
      retryResolution.targetServer !== initialResolution.targetServer,
  };
}

function openViaNvim(filePath, config, options = {}) {
  runEditorCommand("nvim", [...NVIM_INIT_ARGS, filePath]);

  const decision = {
    requestedMode: config.openMode,
    effectiveMode: "nvim",
    command: "nvim",
    waitMode: "process",
  };

  const fallbackFrom = String(options.fallbackFrom ?? "").trim();
  if (fallbackFrom) {
    decision.fallbackFrom = fallbackFrom;
  }

  if (options.nvrResolution) {
    Object.assign(decision, makeNvrRoutingMetadata(options.nvrResolution));
  }

  if (typeof options.nvrError !== "undefined") {
    decision.nvrError =
      options.nvrError instanceof Error
        ? options.nvrError.message
        : String(options.nvrError);
  }

  return decision;
}

function openViaNvimArgs(editorArgs, config, options = {}) {
  const nvimArgs = withStandaloneDiffUiCommands(editorArgs);
  runEditorCommand("nvim", nvimArgs);

  const decision = {
    requestedMode: config.openMode,
    effectiveMode: "nvim",
    command: "nvim",
    waitMode: "process",
  };

  const fallbackFrom = String(options.fallbackFrom ?? "").trim();
  if (fallbackFrom) {
    decision.fallbackFrom = fallbackFrom;
  }

  if (options.nvrResolution) {
    Object.assign(decision, makeNvrRoutingMetadata(options.nvrResolution));
  }

  if (typeof options.nvrError !== "undefined") {
    decision.nvrError =
      options.nvrError instanceof Error
        ? options.nvrError.message
        : String(options.nvrError);
  }

  return decision;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveNvrTargetServerWithRetry(
  env = process.env,
  options = {},
) {
  const requestedAttempts = Math.max(1, Number(options.attempts ?? 3));
  const delayMs = Math.max(0, Number(options.delayMs ?? 250));

  const hasTmuxRoutingContext =
    String(env.TMUX ?? "").trim().length > 0 ||
    String(env.PI_EDITOR_OWNER_PANE ?? "").trim().length > 0;

  const attempts = hasTmuxRoutingContext ? requestedAttempts : 1;

  let last = resolveNvrTargetServer(env);
  for (let i = 1; i < attempts; i += 1) {
    if (last.hasTarget) {
      return { ...last, resolutionAttempts: i };
    }
    await sleep(delayMs);
    last = resolveNvrTargetServer(env);
  }

  return { ...last, resolutionAttempts: attempts };
}

async function openViaNvrWithRetry(filePath, env, options = {}) {
  const initialResolution = options.initialResolution;
  const preferFirstErrorOnRetryFailure = Boolean(
    options.preferFirstErrorOnRetryFailure,
  );
  const noWait = Boolean(options.noWait);

  const nvrArgs = makeNvrArgs(initialResolution.targetServer, filePath, {
    noWait,
  });

  try {
    runEditorCommand("nvr", nvrArgs, { captureOutput: true });
    return {
      ok: true,
      resolution: initialResolution,
      nvrRetry: undefined,
    };
  } catch (firstError) {
    if (!isNvrConnectionLostError(firstError)) {
      return {
        ok: false,
        error: firstError,
      };
    }

    const retryResolution = await resolveNvrTargetServerWithRetry(env, {
      attempts: 3,
      delayMs: 250,
    });

    if (!retryResolution.hasTarget) {
      return {
        ok: false,
        error: firstError,
      };
    }

    const retryArgs = makeNvrArgs(retryResolution.targetServer, filePath, {
      noWait,
    });

    try {
      runEditorCommand("nvr", retryArgs, { captureOutput: true });
      return {
        ok: true,
        resolution: retryResolution,
        nvrRetry: makeNvrRetryMetadata(
          firstError,
          retryResolution,
          initialResolution,
        ),
      };
    } catch (retryError) {
      return {
        ok: false,
        error: preferFirstErrorOnRetryFailure ? firstError : retryError,
      };
    }
  }
}

async function openViaNvrArgsWithRetry(editorArgs, env, options = {}) {
  const initialResolution = options.initialResolution;
  const preferFirstErrorOnRetryFailure = Boolean(
    options.preferFirstErrorOnRetryFailure,
  );
  const noWait = Boolean(options.noWait);

  const nvrArgs = makeNvrPassthroughArgs(initialResolution.targetServer, editorArgs, {
    noWait,
  });

  try {
    runEditorCommand("nvr", nvrArgs, { captureOutput: true });
    return {
      ok: true,
      resolution: initialResolution,
      nvrRetry: undefined,
    };
  } catch (firstError) {
    if (!isNvrConnectionLostError(firstError)) {
      return {
        ok: false,
        error: firstError,
      };
    }

    const retryResolution = await resolveNvrTargetServerWithRetry(env, {
      attempts: 3,
      delayMs: 250,
    });

    if (!retryResolution.hasTarget) {
      return {
        ok: false,
        error: firstError,
      };
    }

    const retryArgs = makeNvrPassthroughArgs(
      retryResolution.targetServer,
      editorArgs,
      { noWait },
    );

    try {
      runEditorCommand("nvr", retryArgs, { captureOutput: true });
      return {
        ok: true,
        resolution: retryResolution,
        nvrRetry: makeNvrRetryMetadata(
          firstError,
          retryResolution,
          initialResolution,
        ),
      };
    } catch (retryError) {
      return {
        ok: false,
        error: preferFirstErrorOnRetryFailure ? firstError : retryError,
      };
    }
  }
}

async function openEditor(filePath, config, env = process.env, options = {}) {
  const noWait = Boolean(options.noWait);

  if (config.openMode === "nvr") {
    if (!commandAvailable("nvr")) {
      throw new Error("nvr mode requested, but nvr is not available in PATH");
    }

    const nvrResolution = await resolveNvrTargetServerWithRetry(env, {
      attempts: 3,
      delayMs: 250,
    });

    if (!nvrResolution.hasTarget) {
      throw new Error(
        "nvr mode requested, but no reachable target server was resolved",
      );
    }

    const nvrResult = await openViaNvrWithRetry(filePath, env, {
      initialResolution: nvrResolution,
      preferFirstErrorOnRetryFailure: false,
      noWait,
    });

    if (!nvrResult.ok) {
      throw nvrResult.error;
    }

    return {
      requestedMode: config.openMode,
      effectiveMode: "nvr",
      command: "nvr",
      waitMode: noWait ? "remote-silent" : "remote-wait-silent",
      ...makeNvrRoutingMetadata(nvrResult.resolution),
      ...(nvrResult.nvrRetry ? { nvrRetry: nvrResult.nvrRetry } : {}),
    };
  }

  if (config.openMode === "nvim") {
    return openViaNvim(filePath, config);
  }

  const hasNvr = commandAvailable("nvr");
  const nvrResolution = hasNvr
    ? await resolveNvrTargetServerWithRetry(env, {
        attempts: 3,
        delayMs: 250,
      })
    : {
        hasTarget: false,
        targetServer: "",
        targetSource: "none",
        availableServers: [],
        candidateServers: [],
        ownerPane: String(env.PI_EDITOR_OWNER_PANE ?? "").trim(),
        paneOptionName: "@pi_editor_nvr_server",
        paneOptionStatus: "nvr-unavailable",
        paneOptionDetail: "nvr command is not available",
      };

  if (hasNvr && nvrResolution.hasTarget) {
    const nvrResult = await openViaNvrWithRetry(filePath, env, {
      initialResolution: nvrResolution,
      preferFirstErrorOnRetryFailure: true,
      noWait,
    });

    if (nvrResult.ok) {
      return {
        requestedMode: config.openMode,
        effectiveMode: "nvr",
        command: "nvr",
        waitMode: noWait ? "remote-silent" : "remote-wait-silent",
        ...makeNvrRoutingMetadata(nvrResult.resolution),
        ...(nvrResult.nvrRetry ? { nvrRetry: nvrResult.nvrRetry } : {}),
      };
    }

    return openViaNvim(filePath, config, {
      fallbackFrom: "nvr",
      nvrResolution,
      nvrError: nvrResult.error,
    });
  }

  return openViaNvim(filePath, config, {
    fallbackFrom: hasNvr ? "nvr-no-target-server" : "nvr-unavailable",
    nvrResolution,
  });
}

async function openEditorArgs(editorArgs, config, env = process.env, options = {}) {
  if (!Array.isArray(editorArgs) || editorArgs.length < 1) {
    throw new Error("openEditorArgs requires at least one editor argument");
  }

  const noWait = Boolean(options.noWait);

  if (config.openMode === "nvr") {
    if (!commandAvailable("nvr")) {
      throw new Error("nvr mode requested, but nvr is not available in PATH");
    }

    const nvrResolution = await resolveNvrTargetServerWithRetry(env, {
      attempts: 3,
      delayMs: 250,
    });

    if (!nvrResolution.hasTarget) {
      throw new Error(
        "nvr mode requested, but no reachable target server was resolved",
      );
    }

    const nvrResult = await openViaNvrArgsWithRetry(editorArgs, env, {
      initialResolution: nvrResolution,
      preferFirstErrorOnRetryFailure: false,
      noWait,
    });

    if (!nvrResult.ok) {
      throw nvrResult.error;
    }

    return {
      requestedMode: config.openMode,
      effectiveMode: "nvr",
      command: "nvr",
      waitMode: isDiffEditorArgs(editorArgs) || noWait
        ? "remote-silent"
        : "remote-wait-silent",
      ...makeNvrRoutingMetadata(nvrResult.resolution),
      ...(nvrResult.nvrRetry ? { nvrRetry: nvrResult.nvrRetry } : {}),
    };
  }

  if (config.openMode === "nvim") {
    return openViaNvimArgs(editorArgs, config);
  }

  const hasNvr = commandAvailable("nvr");
  const nvrResolution = hasNvr
    ? await resolveNvrTargetServerWithRetry(env, {
        attempts: 3,
        delayMs: 250,
      })
    : {
        hasTarget: false,
        targetServer: "",
        targetSource: "none",
        availableServers: [],
        candidateServers: [],
        ownerPane: String(env.PI_EDITOR_OWNER_PANE ?? "").trim(),
        paneOptionName: "@pi_editor_nvr_server",
        paneOptionStatus: "nvr-unavailable",
        paneOptionDetail: "nvr command is not available",
      };

  if (hasNvr && nvrResolution.hasTarget) {
    const nvrResult = await openViaNvrArgsWithRetry(editorArgs, env, {
      initialResolution: nvrResolution,
      preferFirstErrorOnRetryFailure: true,
      noWait,
    });

    if (nvrResult.ok) {
      return {
        requestedMode: config.openMode,
        effectiveMode: "nvr",
        command: "nvr",
        waitMode: isDiffEditorArgs(editorArgs) || noWait
          ? "remote-silent"
          : "remote-wait-silent",
        ...makeNvrRoutingMetadata(nvrResult.resolution),
        ...(nvrResult.nvrRetry ? { nvrRetry: nvrResult.nvrRetry } : {}),
      };
    }

    return openViaNvimArgs(editorArgs, config, {
      fallbackFrom: "nvr",
      nvrResolution,
      nvrError: nvrResult.error,
    });
  }

  return openViaNvimArgs(editorArgs, config, {
    fallbackFrom: hasNvr ? "nvr-no-target-server" : "nvr-unavailable",
    nvrResolution,
  });
}

function buildDiffEditorArgs(oldFilePath, newFilePath, extraArgs = []) {
  const oldFile = String(oldFilePath ?? "").trim();
  const newFile = String(newFilePath ?? "").trim();

  if (!oldFile || !newFile) {
    throw new Error("openDiffEditor requires both oldFilePath and newFilePath");
  }

  const normalizedExtraArgs = Array.isArray(extraArgs)
    ? extraArgs.map((arg) => String(arg ?? "")).filter(Boolean)
    : [];

  return ["-d", oldFile, newFile, ...normalizedExtraArgs];
}

async function openDiffEditor(
  oldFilePath,
  newFilePath,
  extraArgs = [],
  config,
  env = process.env,
) {
  const editorArgs = buildDiffEditorArgs(oldFilePath, newFilePath, extraArgs);
  return openEditorArgs(editorArgs, config, env);
}

export { isNvrConnectionLostError, openDiffEditor, openEditor, openEditorArgs };
