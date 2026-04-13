import fs from "fs";
import nodePath from "path";
import { fileURLToPath, pathToFileURL } from "url";

export type ComputeEditsDiffFn = (p: string, e: any[], cwd: string) => Promise<any>;

export type DiffEngineSource =
  | "internal:fs-search"
  | "internal:global-node-modules"
  | "local:fallback"
  | "none";

let computeEditsDiffLoadPromise: Promise<{
  fn?: ComputeEditsDiffFn;
  source: DiffEngineSource;
}> | null = null;

export function loadComputeEditsDiffOnce() {
  if (computeEditsDiffLoadPromise) return computeEditsDiffLoadPromise;

  computeEditsDiffLoadPromise = (async () => {
    const pkgName = "@mariozechner/pi-coding-agent";

    const tryLoadFromAbsolutePath = async (
      editDiffPath: string,
      source: DiffEngineSource,
    ) => {
      if (!fs.existsSync(editDiffPath)) return undefined;
      const mod = await import(pathToFileURL(editDiffPath).href);
      const fn = mod?.computeEditsDiff ?? mod?.default?.computeEditsDiff;
      if (typeof fn !== "function") return undefined;
      return { fn: fn as ComputeEditsDiffFn, source };
    };

    // 1) Local/project search: walk upwards from cwd and extension dir.
    try {
      const extensionDir = nodePath.dirname(fileURLToPath(import.meta.url));
      const tryDirs = [process.cwd(), extensionDir];
      for (const start of tryDirs) {
        let dir = nodePath.resolve(start);
        while (true) {
          const editDiffPath = nodePath.join(
            dir,
            "node_modules",
            pkgName,
            "dist/core/tools/edit-diff.js",
          );
          const loaded = await tryLoadFromAbsolutePath(
            editDiffPath,
            "internal:fs-search",
          );
          if (loaded) return loaded;

          const parent = nodePath.dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
      }
    } catch {
      // ignore and continue
    }

    // 2) Global npm-like locations (covers global pi installations).
    try {
      const globalCandidates = [
        nodePath.resolve(process.execPath, "..", "..", "lib", "node_modules"),
        nodePath.resolve(process.execPath, "..", "..", "node_modules"),
        "/usr/local/lib/node_modules",
        "/opt/homebrew/lib/node_modules",
      ];
      for (const globalRoot of globalCandidates) {
        const editDiffPath = nodePath.join(
          globalRoot,
          pkgName,
          "dist/core/tools/edit-diff.js",
        );
        const loaded = await tryLoadFromAbsolutePath(
          editDiffPath,
          "internal:global-node-modules",
        );
        if (loaded) return loaded;
      }
    } catch {
      // ignore and fall back to local implementation
    }

    return { fn: undefined, source: "local:fallback" as DiffEngineSource };
  })();

  return computeEditsDiffLoadPromise;
}
