import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  buildContext,
  buildWorkingFile,
  DEFAULTS,
  extractPromptFromWorkingFile,
  parseJsonlSession,
  resolveConfig,
  runEditorContext,
  runPiEditor,
  runPlainEditor,
  selectBranch,
} from "../../scripts/pi-editor.mjs";
import { openEditor } from "../../scripts/pi-editor-lib/editor-open.mjs";

const FIXTURES_DIR = path.join(
  process.cwd(),
  "tests",
  "pi-editor",
  "fixtures",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(haystack, needle, message) {
  assert(haystack.includes(needle), `${message} (missing: ${needle})`);
}

function assertNotIncludes(haystack, needle, message) {
  assert(!haystack.includes(needle), `${message} (unexpected: ${needle})`);
}

async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function replacePromptRegion(workingFileContent, nextPrompt) {
  const marker = "<!-- PI_PROMPT_START -->";
  const index = workingFileContent.indexOf(marker);
  assert(index >= 0, "Working file must include PI_PROMPT_START marker");
  const head = workingFileContent.slice(0, index + marker.length);
  return `${head}\n${nextPrompt}`;
}

function parseFormattedBlocks(contextText) {
  return contextText
    .split("\n\n")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.split("\n"));
}

async function writeExecutable(filePath, content) {
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function withPathPrefix(pathPrefix, run) {
  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${pathPrefix}:${previousPath}`;
  try {
    return await run();
  } finally {
    process.env.PATH = previousPath;
  }
}

export const testCases = [
  {
    name: "branch-selects-most-recent-leaf-path",
    ac: ["AC-1"],
    setup:
      "Load branching fixture with two sibling leaves where branch B has the newest leaf timestamp.",
    invocation:
      "Parse JSONL, select branch, and format context with assistant enabled.",
    assertions:
      "Selected leaf is m-006b; branch-B messages are present; sibling branch-A messages are excluded.",
    run: async () => {
      const fixturePath = path.join(FIXTURES_DIR, "session-branching.jsonl");
      const entries = await parseJsonlSession(fixturePath);
      const { branchEntries } = selectBranch(entries);
      const branchIds = branchEntries.map((entry) => entry.id);

      const context = buildContext(branchEntries, {
        ...DEFAULTS,
        enabled: true,
        includeAssistant: true,
        messages: 20,
        maxChars: 10_000,
        maxPerMessage: 1_000,
      });

      assertIncludes(
        branchIds.join(","),
        "m-006b",
        "Selected branch path must include the newest message leaf",
      );
      assertNotIncludes(
        branchIds.join(","),
        "m-005a",
        "Selected branch path must exclude sibling branch-A leaf path",
      );
      assertIncludes(
        context.contextText,
        "Branch B draft: checklist with rollback owners and verification gates.",
        "Context should include assistant content from selected branch",
      );
      assertIncludes(
        context.contextText,
        "Use branch B and add post-release monitoring tasks.",
        "Context should include user message from selected branch",
      );
      assertNotIncludes(
        context.contextText,
        "Branch A draft: basic checklist without owner matrix.",
        "Context should exclude assistant content from sibling branch",
      );
      assertNotIncludes(
        context.contextText,
        "Branch A follow-up that should be excluded when branch B wins.",
        "Context should exclude user content from sibling branch",
      );
    },
  },
  {
    name: "filters-only-user-and-visible-assistant-text",
    ac: ["AC-2"],
    setup:
      "Load mixed-content fixture containing text, thinking, toolCall, toolResult, and summary records.",
    invocation: "Parse, select branch, and build formatted context.",
    assertions:
      "Visible user/assistant text is included while hidden/non-message content is excluded.",
    run: async () => {
      const fixturePath = path.join(
        FIXTURES_DIR,
        "session-compaction-mixed.jsonl",
      );
      const entries = await parseJsonlSession(fixturePath);
      const { branchEntries } = selectBranch(entries);

      const context = buildContext(branchEntries, {
        ...DEFAULTS,
        enabled: true,
        includeAssistant: true,
        messages: 20,
        maxChars: 10_000,
        maxPerMessage: 2_000,
      });

      assertIncludes(
        context.contextText,
        "Step 1: inventory services.",
        "Visible assistant text must be included",
      );
      assertIncludes(
        context.contextText,
        "Expand the rollback section with explicit owners and thresholds.",
        "Visible user text must be included",
      );
      assertIncludes(
        context.contextText,
        "Rollback owner: release manager.",
        "Visible assistant output_text must be included",
      );

      assertNotIncludes(
        context.contextText,
        "hidden chain of thought",
        "Thinking blocks must be excluded",
      );
      assertNotIncludes(
        context.contextText,
        "query_policy_store",
        "Tool calls must be excluded",
      );
      assertNotIncludes(
        context.contextText,
        "policy payload hidden",
        "Tool results must be excluded",
      );
      assertNotIncludes(
        context.contextText,
        "Compaction artifacts must not be treated",
        "Non-message summary records must be excluded",
      );
      assertNotIncludes(
        context.contextText,
        "hidden reasoning block",
        "Assistant thinking blocks must be excluded",
      );
    },
  },
  {
    name: "parses-claude-jsonl-with-uuid-parentuuid-and-role-types",
    ac: ["AC-2"],
    setup:
      "Load Claude-style JSONL fixture with uuid/parentUuid and entry.type user/assistant/progress.",
    invocation: "Parse, select branch, and build context.",
    assertions:
      "Context includes visible user/assistant text and excludes non-visible/tool/progress content.",
    run: async () => {
      const fixturePath = path.join(
        FIXTURES_DIR,
        "session-claude-project.jsonl",
      );
      const entries = await parseJsonlSession(fixturePath);
      const { branchEntries } = selectBranch(entries);

      const context = buildContext(branchEntries, {
        ...DEFAULTS,
        enabled: true,
        includeAssistant: true,
        messages: 20,
        maxChars: 10_000,
        maxPerMessage: 2_000,
      });

      assertIncludes(
        context.contextText,
        "Necesito un plan de migración.",
        "Claude user message should be included",
      );
      assertIncludes(
        context.contextText,
        "Claro, propongo fases con validaciones.",
        "Claude assistant visible text should be included",
      );
      assertIncludes(
        context.contextText,
        "Incluye rollback y responsables.",
        "Claude follow-up user message should be included",
      );
      assertIncludes(
        context.contextText,
        "Perfecto. Agrego rollback, owners y checklist de verificación.",
        "Claude assistant final message should be included",
      );
      assertNotIncludes(
        context.contextText,
        "hidden",
        "Claude thinking blocks should be excluded",
      );
      assertNotIncludes(
        context.contextText,
        "tool_use",
        "Claude tool blocks should be excluded",
      );
    },
  },
  {
    name: "exports-only-prompt-region-after-marker",
    ac: ["AC-3"],
    setup:
      "Create a working file with context block + prompt marker and simulate edits in both regions.",
    invocation: "Run prompt extraction logic on edited working file contents.",
    assertions:
      "Only content after PI_PROMPT_START is exported and context never leaks.",
    run: async () => {
      const promptPath = path.join(FIXTURES_DIR, "temp-prompt.md");
      const promptBase = await fs.readFile(promptPath, "utf8");

      const initial = buildWorkingFile(
        "context line that should never be exported",
        promptBase,
      );

      const edited = initial
        .replace(
          "context line that should never be exported",
          "LEAKED_CONTEXT_SHOULD_NOT_EXPORT",
        )
        .replace(
          promptBase,
          "Final exported prompt content.\nOnly this region is valid.\n",
        );

      const extracted = extractPromptFromWorkingFile(edited);

      assertIncludes(
        extracted,
        "Final exported prompt content.",
        "Prompt section must be exported",
      );
      assertNotIncludes(
        extracted,
        "LEAKED_CONTEXT_SHOULD_NOT_EXPORT",
        "Edited context content must never be exported",
      );
      assertNotIncludes(
        extracted,
        "PI_CONTEXT_START",
        "Context markers must not appear in exported prompt",
      );
    },
  },
  {
    name: "resolves-config-with-env-project-user-default-precedence",
    ac: ["AC-4"],
    setup:
      "Create synthetic user + project config files and set env overrides.",
    invocation: "Resolve effective config with explicit config path overrides.",
    assertions:
      "Env > project > user > defaults precedence is applied per field.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-config-");
      const userConfigPath = path.join(
        sandbox,
        "home",
        ".config",
        "pi-editor",
        "config.json",
      );
      const projectConfigPath = path.join(
        sandbox,
        "workspace",
        ".pi",
        "editor-context.json",
      );

      await fs.mkdir(path.dirname(userConfigPath), { recursive: true });
      await fs.mkdir(path.dirname(projectConfigPath), { recursive: true });

      await fs.writeFile(
        userConfigPath,
        JSON.stringify(
          {
            messages: 5,
            includeAssistant: false,
            maxChars: 1111,
            openMode: "nvim",
            workingMode: "persistent",
          },
          null,
          2,
        ),
        "utf8",
      );

      await fs.writeFile(
        projectConfigPath,
        JSON.stringify(
          {
            messages: 7,
            includeAssistant: true,
            maxChars: 2222,
            openMode: "nvr",
            errorPolicy: "soft",
          },
          null,
          2,
        ),
        "utf8",
      );

      const env = {
        PI_EDITOR_MESSAGES: "9",
        PI_EDITOR_INCLUDE_ASSISTANT: "false",
        PI_EDITOR_MAX_CHARS: "3333",
        PI_EDITOR_ERROR_POLICY: "hard",
      };

      const config = await resolveConfig(env, path.join(sandbox, "workspace"), {
        userConfigPath,
        projectConfigPath,
      });

      assert(config.messages === 9, "Env should override project/user/default");
      assert(
        config.includeAssistant === false,
        "Env boolean should override project/user",
      );
      assert(config.maxChars === 3333, "Env should override project maxChars");
      assert(
        config.errorPolicy === "hard",
        "Env should override project policy",
      );
      assert(
        config.openMode === "nvr",
        "Project should override user for openMode",
      );
      assert(
        config.workingMode === "persistent",
        "User should override defaults when project/env are unset",
      );
    },
  },
  {
    name: "soft-policy-recovers-on-malformed-session-with-fallback-editor",
    ac: ["AC-5"],
    setup: "Create malformed session JSONL and a temp prompt file.",
    invocation:
      "Run wrapper via test hook with soft error policy and injected fallback editor.",
    assertions:
      "No hard failure occurs; fallback editor is invoked; prompt remains editable.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-soft-");
      const tempFile = path.join(sandbox, "prompt.md");
      const malformedSessionPath = path.join(sandbox, "malformed.jsonl");

      await fs.writeFile(tempFile, "Original prompt body\n", "utf8");
      await fs.writeFile(
        malformedSessionPath,
        "{this-is-not-valid-json}\n",
        "utf8",
      );

      let fallbackCalled = false;
      const result = await runEditorContext({
        tempFile,
        env: {
          PI_EDITOR_SESSION_FILE: malformedSessionPath,
          PI_EDITOR_ERROR_POLICY: "soft",
          PI_EDITOR_ENABLED: "true",
          PI_EDITOR_WORKING_MODE: "temp",
        },
        openEditorImpl: () => {
          throw new Error(
            "Working editor should not open when session parse fails",
          );
        },
        fallbackEditorImpl: async (fallbackPath) => {
          fallbackCalled = true;
          await fs.writeFile(
            fallbackPath,
            "Edited in fallback mode without hard failure\n",
            "utf8",
          );
        },
      });

      const exported = await fs.readFile(tempFile, "utf8");

      assert(
        result.status === "soft-recovered",
        "Soft policy should recover instead of throwing",
      );
      assert(fallbackCalled, "Fallback editor must be invoked in soft mode");
      assertIncludes(
        exported,
        "Edited in fallback mode without hard failure",
        "Prompt should remain editable in fallback path",
      );
    },
  },
  {
    name: "enforces-truncation-limits-and-structured-formatting",
    ac: ["AC-6"],
    setup: "Use mixed fixture entries with multiline and oversized messages.",
    invocation:
      "Build context with strict maxPerMessage/maxChars limits and inspect output shape.",
    assertions:
      "Per-message/global truncation and U:/A: + indented continuation formatting are enforced.",
    run: async () => {
      const fixturePath = path.join(
        FIXTURES_DIR,
        "session-compaction-mixed.jsonl",
      );
      const entries = await parseJsonlSession(fixturePath);
      const { branchEntries } = selectBranch(entries);

      const config = {
        ...DEFAULTS,
        enabled: true,
        includeAssistant: true,
        messages: 12,
        maxPerMessage: 120,
        maxChars: 500,
      };

      const context = buildContext(branchEntries, config);
      const blocks = parseFormattedBlocks(context.contextText);

      assert(
        context.contextText.length <= config.maxChars,
        "Global maxChars must be enforced",
      );
      assertIncludes(
        context.contextText,
        "…",
        "At least one message should be truncated with ellipsis",
      );
      assert(
        blocks.length > 0,
        "Formatted context should include at least one message block",
      );

      let sawContinuationLine = false;
      for (const lines of blocks) {
        assert(
          /^([UA]):\s/.test(lines[0]),
          "Each message block must start with U: or A:",
        );
        for (const continuation of lines.slice(1)) {
          if (continuation.length > 0) {
            sawContinuationLine = true;
          }
          assert(
            continuation.startsWith("   "),
            "Continuation lines must be indented by three spaces",
          );
        }
      }

      assert(
        sawContinuationLine,
        "At least one continuation line should exist for multiline formatting",
      );
    },
  },
  {
    name: "workflow-auto-routing-accepts-editor-decision-metadata-shape",
    ac: ["AC-1"],
    setup:
      "Create temp prompt and run orchestration with openMode=auto and injected openEditorImpl metadata return.",
    invocation:
      "runEditorContext uses stubbed openEditorImpl, edits working file, and exports prompt.",
    assertions:
      "Flow succeeds and accepts editorDecision metadata shape while exporting only prompt content.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-routing-");
      const tempFile = path.join(sandbox, "prompt.md");
      const fixturePath = path.join(FIXTURES_DIR, "session-branching.jsonl");
      await fs.writeFile(tempFile, "Prompt before routing test\n", "utf8");

      let capturedWorkingPath = "";
      let capturedConfig = null;

      const result = await runEditorContext({
        tempFile,
        env: {
          PI_EDITOR_ENABLED: "true",
          PI_EDITOR_SESSION_FILE: fixturePath,
          PI_EDITOR_OPEN_MODE: "auto",
          PI_EDITOR_WORKING_MODE: "temp",
          PWD: sandbox,
        },
        openEditorImpl: async (workingPath, config) => {
          capturedWorkingPath = workingPath;
          capturedConfig = config;
          const current = await fs.readFile(workingPath, "utf8");
          const updated = replacePromptRegion(
            current,
            "Prompt updated by auto routing stub\n",
          );
          await fs.writeFile(workingPath, updated, "utf8");

          return {
            requestedMode: "auto",
            effectiveMode: "nvr",
            command: "nvr",
            waitMode: "remote-wait-silent",
            nvrServerAvailable: true,
          };
        },
      });

      const exported = await fs.readFile(tempFile, "utf8");

      assert(
        result.status === "ok",
        "Orchestration should complete successfully",
      );
      assert(
        capturedWorkingPath.length > 0,
        "openEditorImpl should receive a working file path",
      );
      assert(
        capturedConfig?.openMode === "auto",
        "openEditorImpl should receive openMode=auto",
      );
      assertIncludes(
        exported,
        "Prompt updated by auto routing stub",
        "Updated prompt content should be exported",
      );
      assertNotIncludes(
        exported,
        "PI_CONTEXT_START",
        "Exported prompt must not include context marker block",
      );
    },
  },
  {
    name: "soft-fallback-opens-working-file-on-non-connection-editor-failure",
    ac: ["AC-1"],
    setup:
      "Run orchestration with editor failure that is not connection_lost and use fallback editor on working file.",
    invocation:
      "openEditorImpl throws generic error; fallbackEditorImpl edits working file prompt region.",
    assertions:
      "Soft mode invokes fallback and exports prompt-only output without leaking context edits.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-fallback-");
      const tempFile = path.join(sandbox, "prompt.md");
      const fixturePath = path.join(FIXTURES_DIR, "session-branching.jsonl");
      await fs.writeFile(tempFile, "Prompt before fallback test\n", "utf8");

      let fallbackCalled = false;
      let fallbackPath = "";

      const result = await runEditorContext({
        tempFile,
        env: {
          PI_EDITOR_ENABLED: "true",
          PI_EDITOR_SESSION_FILE: fixturePath,
          PI_EDITOR_OPEN_MODE: "auto",
          PI_EDITOR_WORKING_MODE: "temp",
          PI_EDITOR_ERROR_POLICY: "soft",
          PWD: sandbox,
        },
        openEditorImpl: () => {
          throw new Error("generic-editor-crash");
        },
        fallbackEditorImpl: async (nextFallbackPath) => {
          fallbackCalled = true;
          fallbackPath = nextFallbackPath;
          const current = await fs.readFile(nextFallbackPath, "utf8");
          const withLeakedContext = current.replace(
            "Branch B draft: checklist with rollback owners and verification gates.",
            "LEAKED_CONTEXT_SHOULD_NOT_EXPORT",
          );
          const updated = replacePromptRegion(
            withLeakedContext,
            "Prompt updated by fallback working-file flow\n",
          );
          await fs.writeFile(nextFallbackPath, updated, "utf8");
        },
      });

      const exported = await fs.readFile(tempFile, "utf8");

      assert(
        result.status === "soft-recovered",
        "Soft mode should recover from generic editor failure",
      );
      assert(
        fallbackCalled,
        "Fallback editor must be invoked for non-connection failures",
      );
      assert(
        fallbackPath !== tempFile,
        "Fallback path should be working file when available",
      );
      assertIncludes(
        exported,
        "Prompt updated by fallback working-file flow",
        "Fallback-edited prompt should be exported",
      );
      assertNotIncludes(
        exported,
        "LEAKED_CONTEXT_SHOULD_NOT_EXPORT",
        "Context-region edits must not leak into exported prompt",
      );
      assertNotIncludes(
        exported,
        "PI_CONTEXT_START",
        "Exported fallback prompt must not include context markers",
      );
    },
  },
  {
    name: "working-mode-temp-cleans-up-working-directory-after-success",
    ac: ["AC-1"],
    setup:
      "Run orchestration in workingMode=temp and capture generated working file path.",
    invocation: "openEditorImpl edits prompt and returns success metadata.",
    assertions:
      "Temporary working directory is removed after successful export.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-temp-working-");
      const tempFile = path.join(sandbox, "prompt.md");
      const fixturePath = path.join(FIXTURES_DIR, "session-branching.jsonl");
      await fs.writeFile(
        tempFile,
        "Prompt before temp lifecycle test\n",
        "utf8",
      );

      let workingPath = "";

      const result = await runEditorContext({
        tempFile,
        env: {
          PI_EDITOR_ENABLED: "true",
          PI_EDITOR_SESSION_FILE: fixturePath,
          PI_EDITOR_WORKING_MODE: "temp",
          PI_EDITOR_OPEN_MODE: "auto",
          PWD: sandbox,
        },
        openEditorImpl: async (nextWorkingPath) => {
          workingPath = nextWorkingPath;
          const current = await fs.readFile(nextWorkingPath, "utf8");
          const updated = replacePromptRegion(
            current,
            "Prompt updated in temp lifecycle test\n",
          );
          await fs.writeFile(nextWorkingPath, updated, "utf8");
          return {
            requestedMode: "auto",
            effectiveMode: "nvim",
            command: "nvim",
            waitMode: "process",
          };
        },
      });

      assert(
        result.status === "ok",
        "Temp lifecycle flow should complete successfully",
      );
      assert(workingPath.length > 0, "Working path should be captured");
      const workingDirExists = await exists(path.dirname(workingPath));
      assert(
        !workingDirExists,
        "Temporary working directory should be removed after export",
      );
    },
  },
  {
    name: "working-mode-persistent-keeps-working-file-for-inspection",
    ac: ["AC-1"],
    setup:
      "Run orchestration in workingMode=persistent and capture generated working file path.",
    invocation: "openEditorImpl edits prompt and returns success metadata.",
    assertions: "Persistent working file remains available after export.",
    run: async () => {
      const sandbox = await makeTempDir(
        "pi-editor-persistent-working-",
      );
      const tempFile = path.join(sandbox, "prompt.md");
      const fixturePath = path.join(FIXTURES_DIR, "session-branching.jsonl");
      await fs.writeFile(
        tempFile,
        "Prompt before persistent lifecycle test\n",
        "utf8",
      );

      let workingPath = "";

      const result = await runEditorContext({
        tempFile,
        env: {
          PI_EDITOR_ENABLED: "true",
          PI_EDITOR_SESSION_FILE: fixturePath,
          PI_EDITOR_WORKING_MODE: "persistent",
          PI_EDITOR_OPEN_MODE: "auto",
          PWD: sandbox,
        },
        openEditorImpl: async (nextWorkingPath) => {
          workingPath = nextWorkingPath;
          const current = await fs.readFile(nextWorkingPath, "utf8");
          const updated = replacePromptRegion(
            current,
            "Prompt updated in persistent lifecycle test\n",
          );
          await fs.writeFile(nextWorkingPath, updated, "utf8");
          return {
            requestedMode: "auto",
            effectiveMode: "nvim",
            command: "nvim",
            waitMode: "process",
          };
        },
      });

      assert(
        result.status === "ok",
        "Persistent lifecycle flow should complete successfully",
      );
      assert(
        workingPath.length > 0,
        "Persistent working path should be captured",
      );
      assert(
        workingPath.endsWith(".pi-editor.md"),
        "Persistent working file should use .pi-editor.md suffix",
      );
      assert(
        await exists(workingPath),
        "Persistent working file should remain on disk after export",
      );
    },
  },
  {
    name: "editor-open-auto-fallback-preserves-contract-fields",
    ac: ["AC-6"],
    setup:
      "Provide fake nvr/nvim binaries where nvr has no reachable server target.",
    invocation:
      "Call openEditor in auto mode with fake PATH and inspect returned fallback decision.",
    assertions:
      "Fallback decision keeps stable contract fields: effectiveMode, fallbackFrom, and nvr routing metadata.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-contract-fallback-");
      const binDir = path.join(sandbox, "bin");
      await fs.mkdir(binDir, { recursive: true });

      const tempFile = path.join(sandbox, "working.md");
      await fs.writeFile(tempFile, "Prompt body\n", "utf8");

      await writeExecutable(
        path.join(binDir, "nvr"),
        "#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args.includes('--serverlist')) { process.stdout.write('\\n'); process.exit(0); }\nprocess.exit(2);\n",
      );
      await writeExecutable(
        path.join(binDir, "nvim"),
        "#!/usr/bin/env node\nprocess.exit(0);\n",
      );

      const decision = await withPathPrefix(binDir, async () =>
        openEditor(tempFile, { openMode: "auto" }, { PWD: sandbox }),
      );

      assert(
        decision.effectiveMode === "nvim",
        "Fallback decision should use nvim effective mode",
      );
      assert(
        decision.fallbackFrom === "nvr-no-target-server",
        "Fallback decision should preserve fallbackFrom value",
      );
      assert(
        decision.nvrServerAvailable === false,
        "Fallback decision should expose nvrServerAvailable=false",
      );
      assert(
        decision.nvrTargetServer === "",
        "Fallback decision should preserve empty nvrTargetServer when unresolved",
      );
      assert(
        decision.nvrServerSource === "none",
        "Fallback decision should preserve nvr source metadata",
      );
      assert(
        Array.isArray(decision.availableServers),
        "Fallback decision should include availableServers metadata",
      );
      assert(
        Array.isArray(decision.candidateServers),
        "Fallback decision should include candidateServers metadata",
      );
      assert(
        decision.paneOptionStatus === "owner-pane-missing",
        "Fallback decision should preserve pane option status metadata",
      );
    },
  },
  {
    name: "editor-open-auto-retry-preserves-nvr-retry-contract-fields",
    ac: ["AC-6"],
    setup:
      "Provide fake nvr/nvim binaries where first nvr open fails with connection_lost and retry succeeds.",
    invocation:
      "Call openEditor in auto mode with resolvable server and inspect retry metadata.",
    assertions:
      "Successful nvr retry keeps stable fields including effectiveMode=nvr and nvrRetry payload.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-contract-retry-");
      const binDir = path.join(sandbox, "bin");
      const attemptFile = path.join(sandbox, "nvr-attempt.txt");
      await fs.mkdir(binDir, { recursive: true });

      const tempFile = path.join(sandbox, "working.md");
      await fs.writeFile(tempFile, "Prompt body\n", "utf8");

      await writeExecutable(
        path.join(binDir, "nvr"),
        `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const attemptFile = ${JSON.stringify(attemptFile)};
if (args.includes('--serverlist')) {
  process.stdout.write('SERVER_A\\n');
  process.exit(0);
}
let attempt = 0;
try {
  attempt = Number(fs.readFileSync(attemptFile, 'utf8')) || 0;
} catch {}
attempt += 1;
fs.writeFileSync(attemptFile, String(attempt), 'utf8');
if (attempt === 1) {
  process.stderr.write('connection_lost simulated\\n');
  process.exit(1);
}
process.exit(0);
`,
      );
      await writeExecutable(
        path.join(binDir, "nvim"),
        "#!/usr/bin/env node\nprocess.exit(0);\n",
      );

      const decision = await withPathPrefix(binDir, async () =>
        openEditor(
          tempFile,
          { openMode: "auto" },
          { NVIM: "SERVER_A", PWD: sandbox },
        ),
      );

      assert(
        decision.effectiveMode === "nvr",
        "Retry success should keep effectiveMode=nvr",
      );
      assert(
        decision.command === "nvr",
        "Retry success should report nvr command",
      );
      assert(
        decision.waitMode === "remote-wait-silent",
        "Retry success should preserve nvr wait mode",
      );
      assert(
        decision.nvrTargetServer === "SERVER_A",
        "Retry success should preserve selected nvr target server",
      );
      assert(
        decision.nvrServerSource === "env:NVIM",
        "Retry success should preserve target source metadata",
      );
      assert(
        decision.nvrRetry?.attempted === true,
        "Retry success should include nvrRetry.attempted=true",
      );
      assert(
        decision.nvrRetry?.reason === "connection-lost",
        "Retry success should include nvrRetry.reason=connection-lost",
      );
      assert(
        typeof decision.nvrRetry?.firstError === "string" &&
          decision.nvrRetry.firstError.includes("connection_lost"),
        "Retry success should preserve first error message in nvrRetry.firstError",
      );
      assert(
        decision.nvrRetry?.targetChanged === false,
        "Retry success should preserve nvrRetry.targetChanged metadata",
      );
      assert(
        !("fallbackFrom" in decision),
        "Retry success should not include fallbackFrom when nvr ultimately succeeds",
      );
    },
  },
  {
    name: "plain-wrapper-opens-with-shared-editor-layer-without-context-injection",
    ac: ["AC-1", "AC-3"],
    setup:
      "Create temp prompt and fake nvr/nvim binaries where nvr has no server and nvim succeeds.",
    invocation:
      "Run runPlainEditor(tempFile) with PATH override so shared openEditor routing is exercised.",
    assertions:
      "Prompt remains unchanged and context markers are never injected in plain mode.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-plain-no-context-");
      const binDir = path.join(sandbox, "bin");
      await fs.mkdir(binDir, { recursive: true });

      const tempFile = path.join(sandbox, "prompt.md");
      const initialPrompt = "Plain prompt content should stay untouched.\n";
      await fs.writeFile(tempFile, initialPrompt, "utf8");

      await writeExecutable(
        path.join(binDir, "nvr"),
        "#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args.includes('--serverlist')) { process.stdout.write('\\n'); process.exit(0); }\nprocess.exit(2);\n",
      );
      await writeExecutable(
        path.join(binDir, "nvim"),
        "#!/usr/bin/env node\nprocess.exit(0);\n",
      );

      const decision = await withPathPrefix(binDir, async () =>
        runPlainEditor({
          tempFile,
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
            PWD: sandbox,
          },
        }),
      );

      const exported = await fs.readFile(tempFile, "utf8");

      assert(
        decision.effectiveMode === "nvim",
        "Plain wrapper should still return shared editor routing decision",
      );
      assert(
        exported === initialPrompt,
        "Plain wrapper must not rewrite prompt content on its own",
      );
      assertNotIncludes(
        exported,
        "PI_CONTEXT_START",
        "Plain wrapper must not inject context markers",
      );
      assertNotIncludes(
        exported,
        "PI_PROMPT_START",
        "Plain wrapper must not inject prompt markers",
      );
    },
  },
  {
    name: "pi-editor-default-invocation-routes-to-context-mode",
    ac: ["AC-1", "AC-2"],
    setup: "Invoke pi-editor with legacy signature: pi-editor <temp-file>.",
    invocation: "Run runPiEditor with a stubbed context implementation.",
    assertions: "Default mode is context and temp-file is forwarded unchanged.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-default-context-");
      const tempFile = path.join(sandbox, "prompt.md");

      let contextCalled = false;
      const result = await runPiEditor({
        argv: [tempFile],
        env: { ...process.env, PWD: sandbox },
        runEditorContextImpl: async ({ tempFile: received }) => {
          contextCalled = true;
          assert(
            received === tempFile,
            "Legacy invocation must pass temp-file to context pipeline",
          );
          return { status: "ok", mode: "context" };
        },
      });

      assert(contextCalled, "Legacy invocation should call context mode");
      assert(
        result?.status === "ok",
        "Context pipeline result should be returned by pi-editor",
      );
    },
  },
  {
    name: "pi-editor-explicit-context-mode-routes-to-context-pipeline",
    ac: ["AC-2"],
    setup: "Invoke pi-editor with --mode context <temp-file>.",
    invocation: "Run runPiEditor with a stubbed context implementation.",
    assertions: "Explicit context mode routes to context pipeline and does not touch plain path.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-explicit-context-");
      const tempFile = path.join(sandbox, "prompt.md");

      let contextCalled = false;
      const result = await runPiEditor({
        argv: ["--mode", "context", tempFile],
        env: { ...process.env, PWD: sandbox },
        runEditorContextImpl: async ({ tempFile: received }) => {
          contextCalled = true;
          assert(
            received === tempFile,
            "Explicit context mode must pass temp-file to context pipeline",
          );
          return { status: "ok", mode: "context" };
        },
        openEditorImpl: async () => {
          throw new Error("Plain path must not run in explicit context mode");
        },
      });

      assert(contextCalled, "Explicit context mode should call context pipeline");
      assert(
        result?.status === "ok",
        "Explicit context mode should return context pipeline result",
      );
    },
  },
  {
    name: "pi-editor-explicit-plain-mode-uses-shared-open-editor-layer",
    ac: ["AC-2", "AC-3"],
    setup: "Invoke pi-editor with --mode plain and stub config/editor open implementations.",
    invocation: "Run runPiEditor(argv=[--mode, plain, <temp-file>]).",
    assertions: "Plain mode resolves config and calls shared openEditor flow without context path.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-explicit-plain-");
      const tempFile = path.join(sandbox, "prompt.md");

      let resolveConfigCalled = false;
      let openEditorCalled = false;

      const decision = await runPiEditor({
        argv: ["--mode", "plain", tempFile],
        env: { ...process.env, PWD: sandbox },
        resolveConfigImpl: async () => {
          resolveConfigCalled = true;
          return { openMode: "auto" };
        },
        openEditorImpl: async (receivedPath, config) => {
          openEditorCalled = true;
          assert(
            receivedPath === tempFile,
            "Plain mode should call openEditor with provided temp-file",
          );
          assert(
            config?.openMode === "auto",
            "Plain mode should pass resolved editor config",
          );
          return { effectiveMode: "nvim" };
        },
        runEditorContextImpl: async () => {
          throw new Error("Context path must not run in explicit plain mode");
        },
      });

      assert(resolveConfigCalled, "Plain mode should resolve config");
      assert(openEditorCalled, "Plain mode should call shared openEditor layer");
      assert(
        decision?.effectiveMode === "nvim",
        "Plain mode should return openEditor decision",
      );
    },
  },
  {
    name: "pi-editor-plain-mode-passthrough-forwards-generic-editor-args",
    ac: ["AC-2", "AC-3"],
    setup: "Invoke pi-editor with --mode plain and generic editor arguments.",
    invocation:
      "Run runPiEditor(argv=[--mode, plain, +set number, README.md]).",
    assertions: "Plain mode forwards all args to shared passthrough layer unchanged.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-plain-passthrough-");

      let resolveConfigCalled = false;
      let openEditorArgsCalled = false;

      const decision = await runPiEditor({
        argv: ["--mode", "plain", "+set", "number", "README.md"],
        env: { ...process.env, PWD: sandbox },
        resolveConfigImpl: async () => {
          resolveConfigCalled = true;
          return { openMode: "auto" };
        },
        openEditorArgsImpl: async (receivedArgs, config) => {
          openEditorArgsCalled = true;
          assert(
            Array.isArray(receivedArgs),
            "Plain passthrough should receive editor args array",
          );
          assert(
            receivedArgs.join("|") === "+set|number|README.md",
            "Plain passthrough should forward all editor args unchanged",
          );
          assert(
            config?.openMode === "auto",
            "Plain passthrough should pass resolved editor config",
          );
          return { effectiveMode: "nvim", passthrough: true };
        },
        runEditorContextImpl: async () => {
          throw new Error("Context path must not run in explicit plain mode");
        },
      });

      assert(resolveConfigCalled, "Plain passthrough should resolve config");
      assert(
        openEditorArgsCalled,
        "Plain passthrough should call shared openEditorArgs layer",
      );
      assert(
        decision?.passthrough === true,
        "Plain passthrough should return openEditorArgs decision",
      );
    },
  },
  {
    name: "pi-editor-plain-mode-no-wait-is-consumed-and-not-forwarded",
    ac: ["AC-2b"],
    setup: "Invoke pi-editor with --mode plain --no-wait and passthrough args.",
    invocation:
      "Run runPiEditor and inspect forwarded editor args + open options.",
    assertions:
      "--no-wait is consumed by CLI, not forwarded as editor arg, and open path receives noWait=true.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-plain-no-wait-");

      const decision = await runPiEditor({
        argv: ["--mode", "plain", "--no-wait", "+Oil", "/tmp"],
        env: { ...process.env, PWD: sandbox },
        resolveConfigImpl: async () => ({ openMode: "auto" }),
        openEditorArgsImpl: async (receivedArgs, _config, _env, openOptions) => {
          assert(
            receivedArgs.join("|") === "+Oil|/tmp",
            "Plain no-wait should not forward --no-wait as editor arg",
          );
          assert(
            openOptions?.noWait === true,
            "Plain no-wait should request noWait in open options",
          );
          return { effectiveMode: "nvr", waitMode: "remote-silent", noWait: true };
        },
      });

      assert(
        decision?.noWait === true,
        "Plain no-wait should return decision from openEditorArgs path",
      );
    },
  },
  {
    name: "pi-editor-no-wait-is-rejected-outside-plain-mode",
    ac: ["AC-2b"],
    setup: "Invoke non-plain modes with --no-wait.",
    invocation: "Run runPiEditor with invalid no-wait usage.",
    assertions:
      "--no-wait outside plain throws usage error with exitCode=2.",
    run: async () => {
      const invalidArgvCases = [
        ["--mode", "diff", "--no-wait", "old", "new"],
        ["--mode", "context", "--no-wait", "prompt.md"],
        ["--no-wait", "prompt.md"],
      ];

      for (const argv of invalidArgvCases) {
        let capturedError = null;
        try {
          await runPiEditor({ argv });
        } catch (error) {
          capturedError = error;
        }

        assert(capturedError, `Expected usage error for argv: ${argv.join(" ")}`);
        assert(
          Number(capturedError?.exitCode) === 2,
          `Invalid --no-wait usage must set exitCode=2 for argv: ${argv.join(" ")}`,
        );
      }
    },
  },
  {
    name: "files-extension-reveal-path-uses-pi-editor-plain-no-wait",
    ac: ["AC-4", "AC-2b"],
    setup: "Inspect files extension source for pi-editor reveal invocation contract.",
    invocation: "Read extensions/files.ts and assert reveal builder content.",
    assertions:
      "Reveal path includes pi-editor plain + --no-wait contract.",
    run: async () => {
      const filePath = path.join(process.cwd(), "extensions", "files.ts");
      const source = await fs.readFile(filePath, "utf8");

      assertIncludes(
        source,
        "\"--mode\", \"plain\", \"--no-wait\"",
        "Reveal path should construct pi-editor --mode plain --no-wait",
      );
    },
  },
  {
    name: "pi-editor-explicit-diff-mode-routes-to-dedicated-diff-pipeline",
    ac: ["AC-1", "AC-2", "AC-3"],
    setup: "Invoke pi-editor with --mode diff <old> <new>.",
    invocation:
      "Run runPiEditor with diff args and stubbed openDiffEditor implementation.",
    assertions:
      "Diff mode resolves config and uses dedicated diff path (not plain/context paths).",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-explicit-diff-");

      let resolveConfigCalled = false;
      let openDiffCalled = false;

      const decision = await runPiEditor({
        argv: ["--mode", "diff", "old.ts", "new.ts"],
        env: { ...process.env, PWD: sandbox },
        resolveConfigImpl: async () => {
          resolveConfigCalled = true;
          return { openMode: "auto" };
        },
        openDiffEditorImpl: async (oldFile, newFile, extraArgs, config) => {
          openDiffCalled = true;
          assert(oldFile === "old.ts", "Diff mode should pass old file path");
          assert(newFile === "new.ts", "Diff mode should pass new file path");
          assert(
            Array.isArray(extraArgs) && extraArgs.length === 0,
            "Diff mode should pass empty extra args when separator is absent",
          );
          assert(
            config?.openMode === "auto",
            "Diff mode should pass resolved editor config",
          );
          return { effectiveMode: "nvim", diff: true };
        },
        openEditorArgsImpl: async () => {
          throw new Error("Plain passthrough path must not run in diff mode");
        },
        runEditorContextImpl: async () => {
          throw new Error("Context path must not run in explicit diff mode");
        },
      });

      assert(resolveConfigCalled, "Diff mode should resolve config");
      assert(openDiffCalled, "Diff mode should call dedicated openDiffEditor");
      assert(decision?.diff === true, "Diff mode should return diff decision");
    },
  },
  {
    name: "pi-editor-diff-mode-accepts-separator-and-preserves-extra-args",
    ac: ["AC-2", "AC-3"],
    setup:
      "Invoke pi-editor diff mode with -- separator and additional passthrough args.",
    invocation:
      "Run runPiEditor(argv=[--mode, diff, old, new, --, +set, number, +wincmd, l]).",
    assertions:
      "Extras after -- are preserved and forwarded to dedicated diff pipeline.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-diff-extra-args-");

      const decision = await runPiEditor({
        argv: [
          "--mode",
          "diff",
          "old.txt",
          "new.txt",
          "--",
          "+set",
          "number",
          "+wincmd",
          "l",
        ],
        env: { ...process.env, PWD: sandbox },
        resolveConfigImpl: async () => ({ openMode: "auto" }),
        openDiffEditorImpl: async (_old, _new, extraArgs) => {
          assert(
            extraArgs.join("|") === "+set|number|+wincmd|l",
            "Diff mode should preserve extra args after separator",
          );
          return { effectiveMode: "nvim", extraArgs: true };
        },
      });

      assert(
        decision?.extraArgs === true,
        "Diff mode should return decision from dedicated diff pipeline",
      );
    },
  },
  {
    name: "pi-editor-diff-mode-allows-empty-extra-args-after-separator",
    ac: ["AC-2"],
    setup: "Invoke pi-editor diff mode with trailing -- and no extra args.",
    invocation: "Run runPiEditor(argv=[--mode, diff, old, new, --]).",
    assertions:
      "Trailing separator without extras is valid and forwards empty extra args.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-diff-empty-separator-");

      const decision = await runPiEditor({
        argv: ["--mode", "diff", "before.md", "after.md", "--"],
        env: { ...process.env, PWD: sandbox },
        resolveConfigImpl: async () => ({ openMode: "auto" }),
        openDiffEditorImpl: async (_old, _new, extraArgs) => {
          assert(
            Array.isArray(extraArgs) && extraArgs.length === 0,
            "Diff mode should accept trailing separator with empty extra args",
          );
          return { effectiveMode: "nvim", emptySeparator: true };
        },
      });

      assert(
        decision?.emptySeparator === true,
        "Diff mode should return decision for trailing separator form",
      );
    },
  },
  {
    name: "pi-editor-diff-mode-invalid-forms-return-usage-error-with-exit-2",
    ac: ["AC-2"],
    setup: "Evaluate invalid diff argument shapes against parser contract.",
    invocation: "Run runPiEditor with malformed --mode diff invocations.",
    assertions:
      "Each invalid form throws usage error carrying exitCode=2 and usage text.",
    run: async () => {
      const invalidArgvCases = [
        ["--mode", "diff"],
        ["--mode", "diff", "old-only"],
        ["--mode", "diff", "old", "new", "extra-without-separator"],
        ["--mode", "diff", "old", "--", "new"],
        ["--mode", "diff", "old", "--", "new", "extra"],
      ];

      for (const argv of invalidArgvCases) {
        let capturedError = null;
        try {
          await runPiEditor({ argv });
        } catch (error) {
          capturedError = error;
        }

        assert(capturedError, `Expected usage error for argv: ${argv.join(" ")}`);
        assert(
          Number(capturedError?.exitCode) === 2,
          `Invalid diff form must set exitCode=2 for argv: ${argv.join(" ")}`,
        );
        assertIncludes(
          String(capturedError?.message ?? ""),
          "--mode diff <old-file> <new-file> [-- <extra-args...>]",
          "Usage error should include diff syntax contract",
        );
      }
    },
  },
  {
    name: "pi-editor-cli-without-args-returns-usage-and-exit-2",
    ac: ["AC-2"],
    setup: "Run pi-editor CLI entrypoint without required temp-file argument.",
    invocation: "Spawn node scripts/pi-editor.mjs with no args.",
    assertions: "CLI prints usage message and exits with status code 2.",
    run: async () => {
      const scriptPath = path.join(process.cwd(), "scripts", "pi-editor.mjs");
      const result = spawnSync("node", [scriptPath], {
        encoding: "utf8",
      });

      assert(result.status === 2, "pi-editor CLI without args must exit with code 2");
      const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assertIncludes(
        combined,
        "Usage:",
        "pi-editor CLI without args must print usage header",
      );
      assertIncludes(
        combined,
        "pi-editor.mjs --mode diff <old-file> <new-file> [-- <extra-args...>]",
        "pi-editor CLI usage must document explicit diff mode",
      );
    },
  },
  {
    name: "pi-editor-cli-invalid-no-wait-outside-plain-returns-usage-and-exit-2",
    ac: ["AC-2b"],
    setup: "Run pi-editor CLI entrypoint with --mode diff --no-wait.",
    invocation: "Spawn node scripts/pi-editor.mjs --mode diff --no-wait old new.",
    assertions: "CLI prints usage message and exits with status code 2.",
    run: async () => {
      const scriptPath = path.join(process.cwd(), "scripts", "pi-editor.mjs");
      const result = spawnSync(
        "node",
        [scriptPath, "--mode", "diff", "--no-wait", "old", "new"],
        {
          encoding: "utf8",
        },
      );

      assert(
        result.status === 2,
        "pi-editor CLI invalid no-wait usage must exit with code 2",
      );
      const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assertIncludes(
        combined,
        "Usage:",
        "pi-editor CLI invalid no-wait usage must print usage header",
      );
      assertIncludes(
        combined,
        "pi-editor.mjs --mode plain [--no-wait] <editor-args...>",
        "pi-editor CLI usage must document plain no-wait syntax",
      );
    },
  },
  {
    name: "pi-editor-cli-invalid-diff-invocation-returns-usage-and-exit-2",
    ac: ["AC-2"],
    setup: "Run pi-editor CLI entrypoint with malformed diff invocation.",
    invocation: "Spawn node scripts/pi-editor.mjs --mode diff old-only.",
    assertions: "CLI prints usage message and exits with status code 2.",
    run: async () => {
      const scriptPath = path.join(process.cwd(), "scripts", "pi-editor.mjs");
      const result = spawnSync("node", [scriptPath, "--mode", "diff", "old-only"], {
        encoding: "utf8",
      });

      assert(
        result.status === 2,
        "pi-editor CLI invalid diff invocation must exit with code 2",
      );
      const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assertIncludes(
        combined,
        "Usage:",
        "pi-editor CLI invalid diff invocation must print usage header",
      );
      assertIncludes(
        combined,
        "pi-editor.mjs --mode diff <old-file> <new-file> [-- <extra-args...>]",
        "pi-editor CLI invalid diff invocation must print diff usage syntax",
      );
    },
  },
];
