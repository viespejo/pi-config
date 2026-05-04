/**
 * Planning extension configuration
 *
 * Settings are loaded from ~/.pi/agent/extensions/planning.json (global only).
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export type InterviewContextSortOrder =
  | "mtime_desc"
  | "mtime_asc"
  | "name_asc"
  | "name_desc";

export interface PlanningConfig {
  /** Directory where archived plans are stored (should be a git repo) */
  archiveDir?: string;
  /** Directory where active plans are stored (relative to project cwd or absolute) */
  plansDir?: string;
  /** Optional default technical interview slug to seed /plan:save */
  activeTechnicalInterviewSlug?: string;
  /** Sort order for /plan:save interview context selection list */
  interviewContextSortOrder?: InterviewContextSortOrder;
}

export interface ResolvedPlanningConfig {
  archiveDir: string;
  plansDir: string;
  activeTechnicalInterviewSlug?: string;
  interviewContextSortOrder: InterviewContextSortOrder;
}

const DEFAULTS: ResolvedPlanningConfig = {
  archiveDir: ".agentes/archived-plans",
  plansDir: ".agents/plans",
  activeTechnicalInterviewSlug: undefined,
  interviewContextSortOrder: "mtime_desc",
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

    if (
      typeof parsed.activeTechnicalInterviewSlug === "string" &&
      parsed.activeTechnicalInterviewSlug.trim()
    ) {
      config.activeTechnicalInterviewSlug =
        parsed.activeTechnicalInterviewSlug.trim();
    }

    if (
      parsed.interviewContextSortOrder === "mtime_desc" ||
      parsed.interviewContextSortOrder === "mtime_asc" ||
      parsed.interviewContextSortOrder === "name_asc" ||
      parsed.interviewContextSortOrder === "name_desc"
    ) {
      config.interviewContextSortOrder = parsed.interviewContextSortOrder;
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
