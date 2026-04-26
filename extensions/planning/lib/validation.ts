/**
 * Validation helpers for plan metadata and inputs
 */

import type { PlanStatus } from "./types";
import { PlanError } from "./errors";

const PLAN_STATUS_SET = new Set<PlanStatus>([
  "draft",
  "pending",
  "in-progress",
  "completed",
  "cancelled",
  "abandoned",
]);

const PLAN_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ValidatedPlanFrontmatter {
  date: string;
  title: string;
  directory: string;
  project?: string;
  status: PlanStatus;
  dependencies: string[];
  dependents: string[];
  assignedSession?: string;
}

interface ValidationContext {
  filename: string;
  cwd: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asStringArray(
  value: unknown,
  fieldName: "dependencies" | "dependents",
): string[] {
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    throw new PlanError(
      "INVALID_FRONTMATTER",
      `${fieldName} must be an array`,
      {
        field: fieldName,
      },
    );
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new PlanError(
        "INVALID_FRONTMATTER",
        `${fieldName}[${index}] must be a string slug`,
        { field: fieldName, index },
      );
    }

    const slug = entry.trim();
    if (!PLAN_SLUG_PATTERN.test(slug)) {
      throw new PlanError(
        "INVALID_FRONTMATTER",
        `${fieldName}[${index}] must be kebab-case slug`,
        { field: fieldName, index, value: entry },
      );
    }

    return slug;
  });
}

function asStatus(value: unknown): PlanStatus {
  if (typeof value !== "string" || !PLAN_STATUS_SET.has(value as PlanStatus)) {
    throw new PlanError(
      "INVALID_FRONTMATTER",
      `status must be one of: ${Array.from(PLAN_STATUS_SET).join(", ")}`,
      { field: "status", value },
    );
  }

  return value as PlanStatus;
}

export function validatePlanFrontmatter(
  frontmatter: unknown,
  context: ValidationContext,
): ValidatedPlanFrontmatter {
  const record = asRecord(frontmatter);
  if (!record) {
    throw new PlanError(
      "INVALID_FRONTMATTER",
      "frontmatter must be an object",
      context as unknown as Record<string, unknown>,
    );
  }

  const fallbackDate =
    context.filename.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1] ?? "";
  const date = asOptionalString(record.date) ?? fallbackDate;
  const title =
    asOptionalString(record.title) ?? context.filename.replace(/\.md$/, "");
  const directory = asOptionalString(record.directory) ?? context.cwd;
  const project = asOptionalString(record.project);
  const status =
    record.status === undefined ? "pending" : asStatus(record.status);

  const dependencies = asStringArray(record.dependencies, "dependencies");
  const dependents = asStringArray(record.dependents, "dependents");
  const assignedSession = asOptionalString(record.assigned_session);

  return {
    date,
    title,
    directory,
    project,
    status,
    dependencies,
    dependents,
    assignedSession,
  };
}
