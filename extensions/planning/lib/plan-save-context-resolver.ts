import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { InterviewContextSortOrder } from "./config";
import { selectInterviewContext } from "./interview-context-selector";

export interface TechnicalInterviewCandidate {
  slug: string;
  logPath: string;
  planPath: string;
  mtimeMs: number;
}

export interface ContinuitySummary {
  path: string;
  filename: string;
  mtimeMs: number;
}

export interface ResolvedInterviewContext {
  source: "active" | "selection" | "none" | "cancelled";
  candidate: TechnicalInterviewCandidate | null;
  summaries: ContinuitySummary[];
  confidence?: "high" | "low";
}

export interface PlanReferencePaths {
  planFormatReferencePath: string;
  planTemplateReferencePath: string;
}

async function isReadableNonEmpty(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export async function resolvePlanReferencePaths(): Promise<PlanReferencePaths | null> {
  const referencesDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "references",
  );

  const planFormatReferencePath = path.join(referencesDir, "plan-format.md");
  const planTemplateReferencePath = path.join(referencesDir, "plan-template.md");

  const [formatOk, templateOk] = await Promise.all([
    isReadableNonEmpty(planFormatReferencePath),
    isReadableNonEmpty(planTemplateReferencePath),
  ]);

  if (!formatOk || !templateOk) return null;

  return {
    planFormatReferencePath,
    planTemplateReferencePath,
  };
}

export async function discoverInterviewPairs(cwd: string): Promise<TechnicalInterviewCandidate[]> {
  const interviewsDir = path.resolve(cwd, "docs", "technical-interviews");

  let entries: string[] = [];
  try {
    entries = await fs.readdir(interviewsDir);
  } catch {
    return [];
  }

  const logSlugs = new Set(
    entries
      .filter((name) => name.endsWith("_log.md"))
      .map((name) => name.replace(/_log\.md$/, "")),
  );

  const planSlugs = new Set(
    entries
      .filter((name) => name.endsWith("_plan.md"))
      .map((name) => name.replace(/_plan\.md$/, "")),
  );

  const slugs = [...logSlugs].filter((slug) => planSlugs.has(slug));

  const candidates: TechnicalInterviewCandidate[] = [];
  for (const slug of slugs) {
    const logPath = path.join(interviewsDir, `${slug}_log.md`);
    const planPath = path.join(interviewsDir, `${slug}_plan.md`);

    const [logOk, planOk] = await Promise.all([
      isReadableNonEmpty(logPath),
      isReadableNonEmpty(planPath),
    ]);

    if (!logOk || !planOk) continue;

    const [logStat, planStat] = await Promise.all([fs.stat(logPath), fs.stat(planPath)]);
    candidates.push({
      slug,
      logPath,
      planPath,
      mtimeMs: Math.max(logStat.mtimeMs, planStat.mtimeMs),
    });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates;
}

function normalizeDependencySlug(value: string): string {
  return value.trim().toLowerCase().replace(/\.md$/i, "");
}

function summaryBaseFromFilename(filename: string): string {
  return filename.replace(/-SUMMARY\.md$/i, "");
}

async function discoverContinuitySummariesForDependencies(
  cwd: string,
  plansDir: string,
  dependencies: string[],
): Promise<ContinuitySummary[]> {
  if (dependencies.length === 0) return [];

  const wanted = new Set(dependencies.map(normalizeDependencySlug));
  const baseDir = path.isAbsolute(plansDir) ? plansDir : path.resolve(cwd, plansDir);

  let entries: string[] = [];
  try {
    entries = await fs.readdir(baseDir);
  } catch {
    return [];
  }

  const summaryFiles = entries.filter((name) => /-SUMMARY\.md$/i.test(name));

  const matched: ContinuitySummary[] = [];
  for (const filename of summaryFiles) {
    const summaryBase = normalizeDependencySlug(summaryBaseFromFilename(filename));
    if (!wanted.has(summaryBase)) continue;

    const filePath = path.join(baseDir, filename);
    const stat = await fs.stat(filePath);

    matched.push({
      path: filePath,
      filename,
      mtimeMs: stat.mtimeMs,
    });
  }

  return matched.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function toResolvedContext(
  candidate: TechnicalInterviewCandidate,
  source: ResolvedInterviewContext["source"],
  confidence: ResolvedInterviewContext["confidence"],
  summaries: ContinuitySummary[],
): ResolvedInterviewContext {
  return {
    source,
    candidate,
    summaries,
    confidence,
  };
}

function sortCandidates(
  candidates: TechnicalInterviewCandidate[],
  sortOrder: InterviewContextSortOrder,
): TechnicalInterviewCandidate[] {
  const sorted = [...candidates];
  switch (sortOrder) {
    case "mtime_asc":
      return sorted.sort((a, b) => a.mtimeMs - b.mtimeMs || a.slug.localeCompare(b.slug));
    case "name_asc":
      return sorted.sort((a, b) => a.slug.localeCompare(b.slug) || b.mtimeMs - a.mtimeMs);
    case "name_desc":
      return sorted.sort((a, b) => b.slug.localeCompare(a.slug) || b.mtimeMs - a.mtimeMs);
    case "mtime_desc":
    default:
      return sorted.sort((a, b) => b.mtimeMs - a.mtimeMs || a.slug.localeCompare(b.slug));
  }
}

export async function resolveInterviewContext(params: {
  cwd: string;
  plansDir: string;
  additionalInstructions: string;
  recentConversationText?: string;
  activeSlug?: string;
  requestedDependencies?: string[];
  interviewContextSortOrder?: InterviewContextSortOrder;
  ctx: ExtensionCommandContext;
}): Promise<ResolvedInterviewContext> {
  const {
    cwd,
    plansDir,
    additionalInstructions,
    recentConversationText,
    activeSlug,
    requestedDependencies = [],
    interviewContextSortOrder = "mtime_desc",
    ctx,
  } = params;

  void additionalInstructions;
  void recentConversationText;

  const [candidates, summaries] = await Promise.all([
    discoverInterviewPairs(cwd),
    discoverContinuitySummariesForDependencies(cwd, plansDir, requestedDependencies),
  ]);

  if (candidates.length === 0) {
    return {
      source: "none",
      candidate: null,
      summaries,
    };
  }

  if (activeSlug) {
    const activeCandidate = candidates.find((c) => c.slug === activeSlug.trim());
    if (activeCandidate) {
      return toResolvedContext(activeCandidate, "active", "high", summaries);
    }
  }

  const sortedCandidates = sortCandidates(candidates, interviewContextSortOrder);

  if (ctx.hasUI) {
    const selectedSlug = await selectInterviewContext(ctx, sortedCandidates);

    if (selectedSlug === "__CANCELLED__") {
      return {
        source: "cancelled",
        candidate: null,
        summaries,
      };
    }

    if (!selectedSlug) {
      return {
        source: "none",
        candidate: null,
        summaries,
      };
    }

    const selectedCandidate = sortedCandidates.find((c) => c.slug === selectedSlug);
    if (selectedCandidate) {
      return toResolvedContext(selectedCandidate, "selection", "low", summaries);
    }

    return {
      source: "none",
      candidate: null,
      summaries,
    };
  }

  return {
    source: "none",
    candidate: null,
    summaries,
  };
}
