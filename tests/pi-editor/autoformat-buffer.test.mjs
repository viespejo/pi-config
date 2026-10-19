import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("context autoformat protection survives buffer reloads and stays path-scoped", async (t) => {
  const available = spawnSync("nvim", ["--version"], { encoding: "utf8" });
  if (available.error?.code === "ENOENT") {
    t.skip("Neovim is required for the native buffer lifecycle test");
    return;
  }
  assert.equal(available.status, 0);

  const source = await readFile(
    new URL("../../scripts/pi-editor-lib/editor-open.mjs", import.meta.url),
    "utf8",
  );
  const match = source.match(/const FOLD_LUA_CMD =\s*("[^\n]+");/);
  assert(match, "The shared setup command must be available");
  const setup = JSON.parse(match[1]);
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "pi-editor-buffer-"));

  try {
    const home = path.join(sandbox, "home");
    const otherDir = path.join(sandbox, "other");
    await mkdir(home);
    await mkdir(otherDir);
    const target = path.join(sandbox, "working [a],?.md");
    const other = path.join(otherDir, path.basename(target));
    const cleanup = path.join(sandbox, "cleanup.md");
    const script = path.join(sandbox, "check.lua");
    const content = "<!-- PI_PROMPT_START -->\nSynthetic prompt\n";
    await writeFile(target, content);
    await writeFile(other, content);
    await writeFile(cleanup, "Synthetic cleanup fixture\n");
    await writeFile(script, `
local target = vim.env.PI_EDITOR_TEST_TARGET
local other = vim.env.PI_EDITOR_TEST_OTHER
local cleanup = vim.env.PI_EDITOR_TEST_CLEANUP
local function edit(file)
  vim.cmd('edit ' .. vim.fn.fnameescape(file))
end
edit(target)
vim.bo.bufhidden = 'delete'
vim.cmd(vim.env.PI_EDITOR_TEST_SETUP)
assert(vim.b.disable_autoformat == true, 'Initial context must be protected')
assert(vim.bo.bufhidden == 'delete', 'Do not change the closing contract')
vim.cmd(vim.env.PI_EDITOR_TEST_SETUP)
edit(other)
assert(vim.b.disable_autoformat == nil, 'Same basename at another path must not be protected')
edit(target)
assert(vim.b.disable_autoformat == true, 'Reopened intermediary must regain protection')
assert(not vim.g.disable_autoformat, 'Global autoformat must remain enabled')
local group = 'PiEditorContext_' .. vim.fn.sha256(vim.api.nvim_buf_get_name(0))
assert(#vim.api.nvim_get_autocmds({group=group,event='BufReadPost'}) == 1, 'Do not duplicate registration')
edit(other)
assert(vim.b.disable_autoformat == nil, 'Other buffer must remain unchanged after returning')
assert(vim.fn.delete(target) == 0, 'Remove only the synthetic owned fixture')
edit(cleanup)
assert(vim.fn.exists('#' .. group) == 0, 'Remove owned rule when the intermediary disappears')
assert(vim.b.disable_autoformat == nil, 'Cleanup must not affect another buffer')
print('PASS exact-path reopen, unchanged deletion, duplicate prevention and cleanup')
`);

    const result = spawnSync(
      "nvim",
      ["--headless", "-u", "NONE", "-i", "NONE", "-n", "-l", script],
      {
        cwd: sandbox,
        encoding: "utf8",
        timeout: 20_000,
        env: {
          HOME: home,
          PATH: process.env.PATH,
          TMPDIR: sandbox,
          XDG_CONFIG_HOME: path.join(home, ".config"),
          XDG_DATA_HOME: path.join(home, ".local/share"),
          XDG_STATE_HOME: path.join(home, ".local/state"),
          XDG_CACHE_HOME: path.join(home, ".cache"),
          PI_EDITOR_TEST_SETUP: setup,
          PI_EDITOR_TEST_TARGET: target,
          PI_EDITOR_TEST_OTHER: other,
          PI_EDITOR_TEST_CLEANUP: cleanup,
        },
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /PASS exact-path reopen/);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
