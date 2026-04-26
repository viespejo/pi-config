/**
 * Plan repository: centralized file storage operations (functional repository API)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { deriveSlug } from "./dependencies";
import { parseFrontmatter, updateFrontmatterField } from "./frontmatter";
import type { PlanInfo, PlanStatus } from "./types";
import { PlanError } from "./errors";
import { assertValidStatusTransition } from "./domain/lifecycle";
import { validatePlanFrontmatter } from "./validation";
import { appendPlanTelemetryEvent } from "./telemetry";

export const DEFAULT_PLANS_DIR = ".agents/plans";

export interface PlanRepositoryOptions {
  plansDir?: string;
}

const FRONTMATTER_SCAN_CHUNK_BYTES = 4096;
const FRONTMATTER_SCAN_MAX_BYTES = 64 * 1024;

function findFrontmatterEnd(content: string): number | null {
  const match = content.slice(4).match(/\r?\n---(?:\r?\n|$)/);
  if (!match || match.index === undefined) return null;
  return 4 + match.index + match[0].length;
}

async function readPlanFrontmatterContent(planPath: string): Promise<string> {
  const file = await fs.open(planPath, "r");

  try {
    let position = 0;
    let scannedBytes = 0;
    let content = "";

    while (scannedBytes < FRONTMATTER_SCAN_MAX_BYTES) {
      const remaining = FRONTMATTER_SCAN_MAX_BYTES - scannedBytes;
      const chunkSize = Math.min(FRONTMATTER_SCAN_CHUNK_BYTES, remaining);
      const buffer = Buffer.alloc(chunkSize);
      const { bytesRead } = await file.read(buffer, 0, chunkSize, position);
      if (bytesRead <= 0) break;

      scannedBytes += bytesRead;
      position += bytesRead;
      content += buffer.toString("utf-8", 0, bytesRead);

      if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
        return "";
      }

      const end = findFrontmatterEnd(content);
      if (end !== null) {
        return content.slice(0, end);
      }
    }

    return await fs.readFile(planPath, "utf-8");
  } finally {
    await file.close();
  }
}

function mapPlanInfoFromFile(
  frontmatterSource: string,
  cwd: string,
  filename: string,
  fullPath: string,
): PlanInfo {
  const frontmatter = parseFrontmatter(frontmatterSource);
  if (!frontmatter) {
    throw new PlanError(
      "INVALID_FRONTMATTER",
      "Missing or invalid YAML frontmatter",
      {
        filename,
        path: fullPath,
      },
    );
  }

  const validated = validatePlanFrontmatter(frontmatter, { filename, cwd });

  return {
    filename,
    path: fullPath,
    slug: deriveSlug(filename),
    date: validated.date,
    title: validated.title,
    directory: validated.directory,
    project: validated.project,
    status: validated.status,
    dependencies: validated.dependencies,
    dependents: validated.dependents,
    assignedSession: validated.assignedSession,
  };
}

export interface PlanRepository {
  getPlansPath: () => string;
  list: () => Promise<PlanInfo[]>;
  read: (planPath: string) => Promise<string>;
  updateStatus: (planPath: string, status: PlanStatus) => Promise<void>;
  assignSession: (planPath: string, sessionId: string) => Promise<void>;
  clearSessionAssignment: (planPath: string) => Promise<void>;
  delete: (planPath: string) => Promise<void>;
}

export function createPlanRepository(
  cwd: string,
  options: PlanRepositoryOptions = {},
): PlanRepository {
  const configuredPlansDir = options.plansDir?.trim() || DEFAULT_PLANS_DIR;
  const getPlansPath = () =>
    path.isAbsolute(configuredPlansDir)
      ? configuredPlansDir
      : path.join(cwd, configuredPlansDir);

  const readValidatedPlan = async (
    planPath: string,
  ): Promise<{
    content: string;
    filename: string;
    slug: string;
    validated: ReturnType<typeof validatePlanFrontmatter>;
  }> => {
    const content = await fs.readFile(planPath, "utf-8");
    const frontmatter = parseFrontmatter(content);

    if (!frontmatter) {
      throw new PlanError(
        "INVALID_FRONTMATTER",
        "Missing or invalid YAML frontmatter",
        {
          path: planPath,
        },
      );
    }

    const filename = path.basename(planPath);
    const slug = deriveSlug(filename);
    const validated = validatePlanFrontmatter(frontmatter, {
      filename,
      cwd,
    });

    return { content, filename, slug, validated };
  };

  const list = async (): Promise<PlanInfo[]> => {
    const plansPath = getPlansPath();

    try {
      const files = await fs.readdir(plansPath);
      const mdFiles = files
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();

      const plans: PlanInfo[] = [];
      for (const filename of mdFiles) {
        const fullPath = path.join(plansPath, filename);

        try {
          const content = await readPlanFrontmatterContent(fullPath);
          const plan = mapPlanInfoFromFile(content, cwd, filename, fullPath);
          plans.push(plan);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Unknown plan parsing error";
          console.warn(
            `[planning] Skipping invalid plan ${filename}: ${message}`,
          );
        }
      }

      return plans;
    } catch {
      return [];
    }
  };

  const read = async (planPath: string): Promise<string> => {
    return fs.readFile(planPath, "utf-8");
  };

  const updateStatus = async (
    planPath: string,
    status: PlanStatus,
  ): Promise<void> => {
    const { content, slug, validated } = await readValidatedPlan(planPath);

    assertValidStatusTransition(validated.status, status);

    let updated = updateFrontmatterField(content, "status", status);
    if (status === "completed" || status === "abandoned") {
      updated = updateFrontmatterField(updated, "assigned_session", "");
    }

    await fs.writeFile(planPath, updated, "utf-8");

    if (validated.status !== status) {
      await appendPlanTelemetryEvent(getPlansPath(), {
        timestamp: new Date().toISOString(),
        action: "status_transition",
        planPath,
        planSlug: slug,
        from: validated.status,
        to: status,
      });
    }

    if (
      (status === "completed" || status === "abandoned") &&
      validated.assignedSession
    ) {
      await appendPlanTelemetryEvent(getPlansPath(), {
        timestamp: new Date().toISOString(),
        action: "assignment_cleared",
        planPath,
        planSlug: slug,
        sessionId: validated.assignedSession,
      });
    }
  };

  const assignSession = async (
    planPath: string,
    sessionId: string,
  ): Promise<void> => {
    const { content, slug, validated } = await readValidatedPlan(planPath);

    if (
      validated.assignedSession &&
      validated.assignedSession !== sessionId &&
      validated.status !== "completed"
    ) {
      throw new PlanError(
        "PLAN_ASSIGNED_TO_OTHER_SESSION",
        `Plan is already assigned to another session: ${validated.assignedSession}`,
        {
          planPath,
          assignedSession: validated.assignedSession,
          requestedSession: sessionId,
        },
      );
    }

    const updated = updateFrontmatterField(
      content,
      "assigned_session",
      sessionId,
    );
    await fs.writeFile(planPath, updated, "utf-8");

    await appendPlanTelemetryEvent(getPlansPath(), {
      timestamp: new Date().toISOString(),
      action: "assignment_set",
      planPath,
      planSlug: slug,
      sessionId,
    });
  };

  const clearSessionAssignment = async (planPath: string): Promise<void> => {
    const content = await fs.readFile(planPath, "utf-8");
    const frontmatter = parseFrontmatter(content);

    if (!frontmatter) {
      throw new PlanError(
        "INVALID_FRONTMATTER",
        "Missing or invalid YAML frontmatter",
        {
          path: planPath,
        },
      );
    }

    const filename = path.basename(planPath);
    const slug = deriveSlug(filename);
    const updated = updateFrontmatterField(content, "assigned_session", "");
    await fs.writeFile(planPath, updated, "utf-8");

    await appendPlanTelemetryEvent(getPlansPath(), {
      timestamp: new Date().toISOString(),
      action: "assignment_cleared",
      planPath,
      planSlug: slug,
    });
  };

  const remove = async (planPath: string): Promise<void> => {
    await fs.unlink(planPath);
  };

  return {
    getPlansPath,
    list,
    read,
    updateStatus,
    assignSession,
    clearSessionAssignment,
    delete: remove,
  };
}
