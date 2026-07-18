#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify((file, args, callback) => {
  const child = spawn(file, args);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (data) => (stdout += data));
  child.stderr?.on("data", (data) => (stderr += data));
  child.on("error", callback);
  child.on("close", (code) =>
    code === 0 ? callback(null, { stdout, stderr }) : callback(new Error(stderr || `${file} exited ${code}`)),
  );
});
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_BLOCK = "// pi-openai-codex-work-export:start\nexport { openaiCodexOAuth } from \"./auth/oauth/openai-codex.js\";\n// pi-openai-codex-work-export:end\n";
const DECLARATION_BLOCK = "// pi-openai-codex-work-export:start\nexport { openaiCodexOAuth } from \"./auth/oauth/openai-codex.ts\";\n// pi-openai-codex-work-export:end\n";

function fail(message) {
  throw new Error(`Pi OAuth export patch: ${message}`);
}

function requireSupportedNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) fail("Node.js >=22.19.0 is required");
}

async function realpath(path) {
  return (await import("node:fs/promises")).realpath(path);
}

function markerState(contents) {
  const starts = (contents.match(/pi-openai-codex-work-export:start/g) ?? []).length;
  const ends = (contents.match(/pi-openai-codex-work-export:end/g) ?? []).length;
  if (starts !== ends || starts > 1) fail("managed export markers are partial or duplicated");
  return starts === 1;
}

async function findPackage(start) {
  let current = dirname(start);
  while (current !== dirname(current)) {
    try {
      const pkg = JSON.parse(await readFile(join(current, "package.json"), "utf8"));
      if (pkg.name === "@earendil-works/pi-coding-agent") return current;
    } catch {}
    current = dirname(current);
  }
  fail("could not locate the Pi package owning the effective executable");
}

export async function resolveTarget(kind) {
  requireSupportedNode();
  if (kind === "local") {
    const piRoot = await realpath(join(root, "node_modules/@earendil-works/pi-coding-agent"));
    const piAiRoot = await realpath(join(piRoot, "node_modules/@earendil-works/pi-ai"));
    return { kind, piAiRoot, piRoot, executable: join(piRoot, "dist/cli.js") };
  }
  if (kind !== "global") fail(`unknown target ${kind}`);
  const localBin = join(root, "node_modules/.bin");
  let executable;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (resolve(directory) === localBin) continue;
    try {
      const candidate = join(directory, "pi");
      await access(candidate);
      executable = await realpath(candidate);
      break;
    } catch {}
  }
  if (!executable) fail("could not find a global pi executable on PATH");
  const piRoot = await findPackage(executable);
  if (!relative(root, piRoot) || !relative(root, piRoot).startsWith("..")) {
    fail("effective global Pi resolves inside this repository");
  }
  const piAiRoot = await realpath(join(piRoot, "node_modules/@earendil-works/pi-ai"));
  const version = (await execFile(executable, ["--version"])).stdout.trim();
  const pkg = JSON.parse(await readFile(join(piRoot, "package.json"), "utf8"));
  if (version !== pkg.version) fail(`pi --version (${version}) does not match package version (${pkg.version})`);
  return { kind, piAiRoot, piRoot, executable };
}

export async function validateTarget(target) {
  const runtime = join(target.piAiRoot, "dist/oauth.js");
  const declaration = join(target.piAiRoot, "dist/oauth.d.ts");
  const internal = join(target.piAiRoot, "dist/auth/oauth/openai-codex.js");
  for (const file of [runtime, declaration, internal]) await access(file);
  const [runtimeText, declarationText, internalText] = await Promise.all([readFile(runtime, "utf8"), readFile(declaration, "utf8"), readFile(internal, "utf8")]);
  markerState(runtimeText);
  markerState(declarationText);
  if (!/openaiCodexOAuth/.test(internalText)) fail("internal OpenAI Codex OAuth export is absent");
  return { runtime, declaration, runtimeText, declarationText };
}

async function lockFor(target) {
  const hash = createHash("sha256").update(await realpath(target.piAiRoot)).digest("hex");
  return join(tmpdir(), `pi-oauth-export-patch-${hash}.lock`);
}

async function acquireLock(target) {
  const lock = await lockFor(target);
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
      process.kill(owner.pid, 0);
      fail(`another patch transaction owns ${lock} (PID ${owner.pid})`);
    } catch (ownerError) {
      if (ownerError.message?.includes("another patch transaction")) throw ownerError;
      await rm(lock, { recursive: true, force: true });
      await mkdir(lock);
    }
  }
  await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, target: target.kind }));
  return lock;
}

async function runSmokeTest(target) {
  if (target.kind === "fixture") return;
  const extension = target.kind === "local"
    ? join(root, "extensions/openai-codex-work-provider/src/index.ts")
    : join(process.env.HOME ?? "", ".pi/agent/extensions/openai-codex-work/index.ts");
  await access(extension);
  const child = spawn(process.execPath, [
    target.executable,
    "--no-extensions",
    "--extension", extension,
    "--offline",
    "--list-models", "openai-codex-work",
  ]);
  let output = "";
  child.stdout.on("data", (data) => (output += data));
  child.stderr.on("data", (data) => (output += data));
  const code = await new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill("SIGTERM"), 30000);
    child.on("close", (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
  if (code !== 0 || !/^openai-codex-work\s+/m.test(output)) {
    fail("isolated extension smoke test did not list an OpenAI Codex Work model");
  }
}

async function verify(target) {
  const files = await validateTarget(target);
  if (!markerState(files.runtimeText) || !markerState(files.declarationText)) fail("managed export is not installed");
  const oauth = await import(`${pathToFileURL(files.runtime).href}?patch-check=${Date.now()}`);
  const value = oauth.openaiCodexOAuth;
  if (!value || !["login", "refresh", "toAuth"].every((name) => typeof value[name] === "function")) {
    fail("patched runtime export lacks login, refresh, or toAuth");
  }
  if (!files.declarationText.includes("openaiCodexOAuth")) fail("patched declaration export is absent");
  await runSmokeTest(target);
}

export async function applyPatchTarget(target) {
  const files = await validateTarget(target);
  const lock = await acquireLock(target);
  const originals = { runtime: files.runtimeText, declaration: files.declarationText };
  let active = true;
  const restore = async () => {
    if (!active) return;
    await Promise.all([writeFile(files.runtime, originals.runtime), writeFile(files.declaration, originals.declaration)]);
    active = false;
  };
  const onSignal = () => restore().finally(() => process.exitCode = 1);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    if (!markerState(files.runtimeText)) await writeFile(files.runtime, `${files.runtimeText.trimEnd()}\n${RUNTIME_BLOCK}`);
    if (!markerState(files.declarationText)) await writeFile(files.declaration, `${files.declarationText.trimEnd()}\n${DECLARATION_BLOCK}`);
    await verify(target);
    active = false;
  } catch (error) {
    await restore();
    throw error;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await rm(lock, { recursive: true, force: true });
  }
}

export async function checkPatchTarget(target) {
  await verify(target);
}

async function main() {
  const [targetKind, action] = process.argv.slice(2);
  if (!targetKind || !["apply", "check", "update"].includes(action)) fail("usage: pi-oauth-export-patch.mjs <local|global> <apply|check>");
  if (action === "update") {
    if (targetKind !== "global") fail("only the global target can be updated");
    const globalTarget = await resolveTarget("global");
    const updater = spawn(process.execPath, [globalTarget.executable, "update", "--self", "--no-approve"]);
    const timeout = setTimeout(() => updater.kill("SIGTERM"), 300000);
    const code = await new Promise((resolve, reject) => {
      updater.on("error", reject);
      updater.on("close", resolve);
    });
    clearTimeout(timeout);
    if (code !== 0) fail("global Pi update failed; patching was not attempted");
    const target = await resolveTarget("global");
    await applyPatchTarget(target);
    console.log("Pi OAuth export update succeeded for global");
    return;
  }
  const target = await resolveTarget(targetKind);
  if (action === "apply") await applyPatchTarget(target);
  else await checkPatchTarget(target);
  console.log(`Pi OAuth export ${action} succeeded for ${targetKind}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
