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

function makeNvrArgs(
  targetServer,
  nvrPreOpenArgs,
  nvrWaitArg,
  nvrRemoteCommands,
  filePath,
) {
  return [
    "--nostart",
    "--servername",
    targetServer,
    ...nvrPreOpenArgs,
    nvrWaitArg,
    ...nvrRemoteCommands,
    filePath,
  ];
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

async function openEditor(filePath, config, env = process.env) {
  const nvrWaitArg = "--remote-wait-silent";
  const nvrPreOpenArgs = ["-cc", "split"];
  const foldLuaCmd =
    "lua local marker='<!-- PI_PROMPT_START -->'; local l=vim.fn.search('\\\\V'..marker,'nw'); vim.cmd('silent! normal! zE'); if l>0 then vim.wo.foldmethod='manual'; vim.wo.foldenable=true; vim.cmd(('1,%dfold'):format(l)); pcall(vim.api.nvim_win_set_cursor,0,{l+1,0}); vim.cmd('normal! zt'); end; local last_line=vim.fn.line('$'); local last_col=math.max(vim.fn.col({last_line,'$'})-1,0); pcall(vim.api.nvim_win_set_cursor,0,{last_line,last_col})";
  const nvrRemoteCommands = ["+setlocal bufhidden=delete", `+${foldLuaCmd}`];
  const nvimInitArgs = ["-c", "setlocal bufhidden=delete", "-c", foldLuaCmd];

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

    const nvrArgs = makeNvrArgs(
      nvrResolution.targetServer,
      nvrPreOpenArgs,
      nvrWaitArg,
      nvrRemoteCommands,
      filePath,
    );

    try {
      runEditorCommand("nvr", nvrArgs, { captureOutput: true });

      return {
        requestedMode: config.openMode,
        effectiveMode: "nvr",
        command: "nvr",
        waitMode: "remote-wait-silent",
        nvrServerAvailable: true,
        nvrTargetServer: nvrResolution.targetServer,
        nvrServerSource: nvrResolution.targetSource,
        availableServers: nvrResolution.availableServers,
        candidateServers: nvrResolution.candidateServers,
        ownerPane: nvrResolution.ownerPane,
        paneOptionName: nvrResolution.paneOptionName,
        paneOptionStatus: nvrResolution.paneOptionStatus,
        paneOptionDetail: nvrResolution.paneOptionDetail,
      };
    } catch (firstError) {
      if (!isNvrConnectionLostError(firstError)) {
        throw firstError;
      }

      const retryResolution = await resolveNvrTargetServerWithRetry(env, {
        attempts: 3,
        delayMs: 250,
      });
      if (!retryResolution.hasTarget) {
        throw firstError;
      }

      const retryArgs = makeNvrArgs(
        retryResolution.targetServer,
        nvrPreOpenArgs,
        nvrWaitArg,
        nvrRemoteCommands,
        filePath,
      );

      runEditorCommand("nvr", retryArgs, { captureOutput: true });

      return {
        requestedMode: config.openMode,
        effectiveMode: "nvr",
        command: "nvr",
        waitMode: "remote-wait-silent",
        nvrServerAvailable: true,
        nvrTargetServer: retryResolution.targetServer,
        nvrServerSource: retryResolution.targetSource,
        availableServers: retryResolution.availableServers,
        candidateServers: retryResolution.candidateServers,
        ownerPane: retryResolution.ownerPane,
        paneOptionName: retryResolution.paneOptionName,
        paneOptionStatus: retryResolution.paneOptionStatus,
        paneOptionDetail: retryResolution.paneOptionDetail,
        nvrRetry: {
          attempted: true,
          reason: "connection-lost",
          firstError:
            firstError instanceof Error
              ? firstError.message
              : String(firstError),
          targetChanged:
            retryResolution.targetServer !== nvrResolution.targetServer,
        },
      };
    }
  }

  if (config.openMode === "nvim") {
    runEditorCommand("nvim", [...nvimInitArgs, filePath]);
    return {
      requestedMode: config.openMode,
      effectiveMode: "nvim",
      command: "nvim",
      waitMode: "process",
    };
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
    const nvrArgs = makeNvrArgs(
      nvrResolution.targetServer,
      nvrPreOpenArgs,
      nvrWaitArg,
      nvrRemoteCommands,
      filePath,
    );

    try {
      runEditorCommand("nvr", nvrArgs, { captureOutput: true });
      return {
        requestedMode: config.openMode,
        effectiveMode: "nvr",
        command: "nvr",
        waitMode: "remote-wait-silent",
        nvrServerAvailable: true,
        nvrTargetServer: nvrResolution.targetServer,
        nvrServerSource: nvrResolution.targetSource,
        availableServers: nvrResolution.availableServers,
        candidateServers: nvrResolution.candidateServers,
        ownerPane: nvrResolution.ownerPane,
        paneOptionName: nvrResolution.paneOptionName,
        paneOptionStatus: nvrResolution.paneOptionStatus,
        paneOptionDetail: nvrResolution.paneOptionDetail,
      };
    } catch (error) {
      if (isNvrConnectionLostError(error)) {
        const retryResolution = await resolveNvrTargetServerWithRetry(env, {
          attempts: 3,
          delayMs: 250,
        });
        if (retryResolution.hasTarget) {
          const retryArgs = makeNvrArgs(
            retryResolution.targetServer,
            nvrPreOpenArgs,
            nvrWaitArg,
            nvrRemoteCommands,
            filePath,
          );

          try {
            runEditorCommand("nvr", retryArgs, { captureOutput: true });
            return {
              requestedMode: config.openMode,
              effectiveMode: "nvr",
              command: "nvr",
              waitMode: "remote-wait-silent",
              nvrServerAvailable: true,
              nvrTargetServer: retryResolution.targetServer,
              nvrServerSource: retryResolution.targetSource,
              availableServers: retryResolution.availableServers,
              candidateServers: retryResolution.candidateServers,
              ownerPane: retryResolution.ownerPane,
              paneOptionName: retryResolution.paneOptionName,
              paneOptionStatus: retryResolution.paneOptionStatus,
              paneOptionDetail: retryResolution.paneOptionDetail,
              nvrRetry: {
                attempted: true,
                reason: "connection-lost",
                firstError:
                  error instanceof Error ? error.message : String(error),
                targetChanged:
                  retryResolution.targetServer !== nvrResolution.targetServer,
              },
            };
          } catch {
            // Fall through to nvim fallback with original error context.
          }
        }
      }

      runEditorCommand("nvim", [...nvimInitArgs, filePath]);
      return {
        requestedMode: config.openMode,
        effectiveMode: "nvim",
        command: "nvim",
        waitMode: "process",
        fallbackFrom: "nvr",
        nvrServerAvailable: true,
        nvrTargetServer: nvrResolution.targetServer,
        nvrServerSource: nvrResolution.targetSource,
        availableServers: nvrResolution.availableServers,
        candidateServers: nvrResolution.candidateServers,
        ownerPane: nvrResolution.ownerPane,
        paneOptionName: nvrResolution.paneOptionName,
        paneOptionStatus: nvrResolution.paneOptionStatus,
        paneOptionDetail: nvrResolution.paneOptionDetail,
        nvrError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  runEditorCommand("nvim", [...nvimInitArgs, filePath]);
  return {
    requestedMode: config.openMode,
    effectiveMode: "nvim",
    command: "nvim",
    waitMode: "process",
    fallbackFrom: hasNvr ? "nvr-no-target-server" : "nvr-unavailable",
    nvrServerAvailable: nvrResolution.hasTarget,
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

export { isNvrConnectionLostError, openEditor };
