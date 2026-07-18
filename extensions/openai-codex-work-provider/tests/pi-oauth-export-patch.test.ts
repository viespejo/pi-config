import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyPatchTarget,
  checkPatchTarget,
  validateTarget,
} from "../../../scripts/pi-oauth-export-patch.mjs";

async function fixture(internal = "export const openaiCodexOAuth = { login() {}, refresh() {}, toAuth() {} };\n") {
  const piAiRoot = await mkdtemp(join(tmpdir(), "pi-oauth-export-test-"));
  await mkdir(join(piAiRoot, "dist/auth/oauth"), { recursive: true });
  await writeFile(join(piAiRoot, "dist/oauth.js"), "export {};\n");
  await writeFile(join(piAiRoot, "dist/oauth.d.ts"), "export {};\n");
  await writeFile(join(piAiRoot, "dist/auth/oauth/openai-codex.js"), internal);
  return { kind: "fixture", piAiRoot, piRoot: piAiRoot, executable: "" };
}

async function cleanup(target: { piAiRoot: string }) {
  await rm(target.piAiRoot, { recursive: true, force: true });
}

test("applies idempotently and checks a fixture", async () => {
  const target = await fixture();
  try {
    await applyPatchTarget(target);
    const once = await readFile(join(target.piAiRoot, "dist/oauth.js"), "utf8");
    await applyPatchTarget(target);
    assert.equal(await readFile(join(target.piAiRoot, "dist/oauth.js"), "utf8"), once);
    await checkPatchTarget(target);
  } finally {
    await cleanup(target);
  }
});

test("rejects partial and duplicate markers without mutation", async () => {
  const target = await fixture();
  try {
    const runtime = join(target.piAiRoot, "dist/oauth.js");
    await writeFile(runtime, "// pi-openai-codex-work-export:start\n");
    await assert.rejects(() => applyPatchTarget(target), /partial or duplicated/);
    await writeFile(runtime, "// pi-openai-codex-work-export:start\n// pi-openai-codex-work-export:end\n// pi-openai-codex-work-export:start\n// pi-openai-codex-work-export:end\n");
    await assert.rejects(() => validateTarget(target), /partial or duplicated/);
  } finally {
    await cleanup(target);
  }
});

test("restores both originals when verification fails", async () => {
  const target = await fixture("export const openaiCodexOAuth = {};\n");
  try {
    const runtime = join(target.piAiRoot, "dist/oauth.js");
    const declaration = join(target.piAiRoot, "dist/oauth.d.ts");
    const originals = [await readFile(runtime, "utf8"), await readFile(declaration, "utf8")];
    await assert.rejects(() => applyPatchTarget(target), /lacks login, refresh, or toAuth/);
    assert.deepEqual([await readFile(runtime, "utf8"), await readFile(declaration, "utf8")], originals);
  } finally {
    await cleanup(target);
  }
});

test("rejects active locks and removes stale locks", async () => {
  const target = await fixture();
  const hash = createHash("sha256").update(target.piAiRoot).digest("hex");
  const lock = join(tmpdir(), `pi-oauth-export-patch-${hash}.lock`);
  try {
    await mkdir(lock);
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid }));
    await assert.rejects(() => applyPatchTarget(target), /another patch transaction/);
    await rm(lock, { recursive: true });
    await mkdir(lock);
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: 99999999 }));
    await applyPatchTarget(target);
  } finally {
    await rm(lock, { recursive: true, force: true });
    await cleanup(target);
  }
});

test("requires the internal OAuth capability", async () => {
  const target = await fixture("export {};\n");
  try {
    await assert.rejects(() => validateTarget(target), /internal OpenAI Codex OAuth export is absent/);
  } finally {
    await cleanup(target);
  }
});
