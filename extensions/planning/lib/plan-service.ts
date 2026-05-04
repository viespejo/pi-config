/**
 * Plan service: application logic over the plan repository.
 */

import type { PlanRepository } from "./plan-repository";
import type { PlanInfo, PlanStatus } from "./types";

export interface PlanSuggestion {
  latestPlan?: string;
  latestSlug?: string;
  recommendedPhase: string;
  recommendedPlan: string;
  recommendedFilenamePrefix: string;
  recommendedDependencies: string[];
  alternativeNewPhaseFilenamePrefix: string;
}

export interface PlanService {
  getPlansPath: () => string;
  listPlans: () => Promise<PlanInfo[]>;
  suggestNextPlan: () => Promise<PlanSuggestion>;
  readPlan: (planPath: string) => Promise<string>;
  updatePlanStatus: (planPath: string, status: PlanStatus) => Promise<void>;
  assignPlanSession: (planPath: string, sessionId: string) => Promise<void>;
  clearPlanSession: (planPath: string) => Promise<void>;
  deletePlan: (planPath: string) => Promise<void>;
}

function parseNumericPrefix(filename: string): { phase: number; plan: number } | null {
  const base = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
  const match = base.match(/^(\d+)-(\d+)(?:-|$)/);
  if (!match) return null;

  const phase = Number.parseInt(match[1] ?? "", 10);
  const plan = Number.parseInt(match[2] ?? "", 10);

  if (!Number.isFinite(phase) || !Number.isFinite(plan)) return null;
  return { phase, plan };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function createPlanService(repository: PlanRepository): PlanService {
  return {
    getPlansPath: repository.getPlansPath,
    listPlans: () => repository.list(),
    suggestNextPlan: async () => {
      const plans = await repository.list();

      let latest: PlanInfo | undefined;
      let latestPhase = 1;
      let latestPlan = 0;

      for (const plan of plans) {
        const prefix = parseNumericPrefix(plan.filename);
        if (!prefix) continue;

        if (
          prefix.phase > latestPhase
          || (prefix.phase === latestPhase && prefix.plan > latestPlan)
        ) {
          latest = plan;
          latestPhase = prefix.phase;
          latestPlan = prefix.plan;
        }
      }

      const recommendedPhaseNumber = latest ? latestPhase : 1;
      const recommendedPlanNumber = latest ? latestPlan + 1 : 1;
      const nextPhaseNumber = latest ? latestPhase + 1 : 2;

      return {
        latestPlan: latest?.filename,
        latestSlug: latest?.slug,
        recommendedPhase: latest?.phase ?? `${pad2(recommendedPhaseNumber)}-new-phase`,
        recommendedPlan: pad2(recommendedPlanNumber),
        recommendedFilenamePrefix:
          `${pad2(recommendedPhaseNumber)}-${pad2(recommendedPlanNumber)}`,
        recommendedDependencies: latest ? [latest.slug] : [],
        alternativeNewPhaseFilenamePrefix: `${pad2(nextPhaseNumber)}-01`,
      };
    },
    readPlan: (planPath) => repository.read(planPath),
    updatePlanStatus: (planPath, status) => repository.updateStatus(planPath, status),
    assignPlanSession: (planPath, sessionId) =>
      repository.assignSession(planPath, sessionId),
    clearPlanSession: (planPath) => repository.clearSessionAssignment(planPath),
    deletePlan: (planPath) => repository.delete(planPath),
  };
}
