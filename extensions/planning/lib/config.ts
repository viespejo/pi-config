/**
 * Planning extension configuration
 *
 * Settings are loaded from ~/.pi/agent/extensions/planning.json (global only).
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface PlanningConfig {
  /** Directory where archived plans are stored (should be a git repo) */
  archiveDir?: string;
  /** Directory where active plans are stored (relative to project cwd or absolute) */
  plansDir?: string;
}

export interface ResolvedPlanningConfig {
  archiveDir: string;
  plansDir: string;
}

const DEFAULTS: ResolvedPlanningConfig = {
  archiveDir: "",
  plansDir: ".agents/plans",
};

let currentConfig: ResolvedPlanningConfig = { ...DEFAULTS };

export async function loadConfig(): Promise<ResolvedPlanningConfig> {
  const configPath = path.join(
    os.homedir(),
    ".pi",
    "agent",
    "extensions",
    "planning.json",
  );

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as PlanningConfig;
    const config = { ...DEFAULTS };

    if (typeof parsed.archiveDir === "string") {
      config.archiveDir = parsed.archiveDir.trim();
    }

    if (typeof parsed.plansDir === "string" && parsed.plansDir.trim()) {
      config.plansDir = parsed.plansDir.trim();
    }
    currentConfig = config;
  } catch {
    currentConfig = { ...DEFAULTS };
  }
  return currentConfig;
}

export function getConfig(): ResolvedPlanningConfig {
  return currentConfig;
}

