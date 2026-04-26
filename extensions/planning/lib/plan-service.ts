/**
 * Plan service: application logic over the plan repository.
 */

import type { PlanRepository } from "./plan-repository";
import type { PlanInfo, PlanStatus } from "./types";

export interface PlanService {
  getPlansPath: () => string;
  listPlans: () => Promise<PlanInfo[]>;
  readPlan: (planPath: string) => Promise<string>;
  updatePlanStatus: (planPath: string, status: PlanStatus) => Promise<void>;
  assignPlanSession: (planPath: string, sessionId: string) => Promise<void>;
  clearPlanSession: (planPath: string) => Promise<void>;
  deletePlan: (planPath: string) => Promise<void>;
}

export function createPlanService(repository: PlanRepository): PlanService {
  return {
    getPlansPath: repository.getPlansPath,
    listPlans: () => repository.list(),
    readPlan: (planPath) => repository.read(planPath),
    updatePlanStatus: (planPath, status) => repository.updateStatus(planPath, status),
    assignPlanSession: (planPath, sessionId) =>
      repository.assignSession(planPath, sessionId),
    clearPlanSession: (planPath) => repository.clearSessionAssignment(planPath),
    deletePlan: (planPath) => repository.delete(planPath),
  };
}
