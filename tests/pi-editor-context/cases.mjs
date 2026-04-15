import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildContext,
  buildWorkingFile,
  DEFAULTS,
  extractPromptFromWorkingFile,
  parseJsonlSession,
  resolveConfig,
  runEditorContext,
  selectBranch,
} from "../../scripts/pi-editor-context.mjs";

const FIXTURES_DIR = path.join(
  process.cwd(),
  "tests",
  "pi-editor-context",
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

function parseFormattedBlocks(contextText) {
  return contextText
    .split("\n\n")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.split("\n"));
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
      const sandbox = await makeTempDir("pi-editor-context-config-");
      const userConfigPath = path.join(
        sandbox,
        "home",
        ".config",
        "pi-editor-context",
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
        PI_EDITOR_CONTEXT_MESSAGES: "9",
        PI_EDITOR_CONTEXT_INCLUDE_ASSISTANT: "false",
        PI_EDITOR_CONTEXT_MAX_CHARS: "3333",
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
      assert(config.errorPolicy === "hard", "Env should override project policy");
      assert(config.openMode === "nvr", "Project should override user for openMode");
      assert(
        config.workingMode === "persistent",
        "User should override defaults when project/env are unset",
      );

    },
  },
  {
    name: "soft-policy-recovers-on-malformed-session-with-fallback-editor",
    ac: ["AC-5"],
    setup:
      "Create malformed session JSONL and a temp prompt file.",
    invocation:
      "Run wrapper via test hook with soft error policy and injected fallback editor.",
    assertions:
      "No hard failure occurs; fallback editor is invoked; prompt remains editable.",
    run: async () => {
      const sandbox = await makeTempDir("pi-editor-context-soft-");
      const tempFile = path.join(sandbox, "prompt.md");
      const malformedSessionPath = path.join(sandbox, "malformed.jsonl");

      await fs.writeFile(tempFile, "Original prompt body\n", "utf8");
      await fs.writeFile(malformedSessionPath, "{this-is-not-valid-json}\n", "utf8");

      let fallbackCalled = false;
      const result = await runEditorContext({
        tempFile,
        env: {
          PI_EDITOR_CONTEXT_SESSION_FILE: malformedSessionPath,
          PI_EDITOR_ERROR_POLICY: "soft",
          PI_EDITOR_CONTEXT_ENABLED: "true",
          PI_EDITOR_WORKING_MODE: "temp",
        },
        openEditorImpl: () => {
          throw new Error("Working editor should not open when session parse fails");
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
    setup:
      "Use mixed fixture entries with multiline and oversized messages.",
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

      assert(context.contextText.length <= config.maxChars, "Global maxChars must be enforced");
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
];
