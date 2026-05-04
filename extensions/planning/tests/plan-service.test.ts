import assert from "node:assert/strict";
import test from "node:test";

import { createPlanService } from "../lib/plan-service.ts";
import type { PlanRepository } from "../lib/plan-repository.ts";

function createFakeRepository(overrides: Partial<PlanRepository> = {}) {
  const calls: unknown[][] = [];

  const repository: PlanRepository = {
    getPlansPath: () => {
      calls.push(["getPlansPath"]);
      return "/tmp/plans";
    },
    list: async () => {
      calls.push(["list"]);
      return [{ slug: "a" }, { slug: "b" }] as never;
    },
    read: async (planPath: string) => {
      calls.push(["read", planPath]);
      return `content:${planPath}`;
    },
    updateStatus: async (planPath: string, status) => {
      calls.push(["updateStatus", planPath, status]);
    },
    assignSession: async (planPath: string, sessionId: string) => {
      calls.push(["assignSession", planPath, sessionId]);
    },
    clearSessionAssignment: async (planPath: string) => {
      calls.push(["clearSessionAssignment", planPath]);
    },
    delete: async (planPath: string) => {
      calls.push(["delete", planPath]);
    },
    ...overrides,
  };

  return { repository, calls };
}

test("createPlanService exposes the expected operations", () => {
  const { repository } = createFakeRepository();
  const service = createPlanService(repository);

  assert.equal(typeof service.getPlansPath, "function");
  assert.equal(typeof service.listPlans, "function");
  assert.equal(typeof service.suggestNextPlan, "function");
  assert.equal(typeof service.readPlan, "function");
  assert.equal(typeof service.updatePlanStatus, "function");
  assert.equal(typeof service.assignPlanSession, "function");
  assert.equal(typeof service.clearPlanSession, "function");
  assert.equal(typeof service.deletePlan, "function");
});

test("listPlans delegates to repository.list", async () => {
  const { repository, calls } = createFakeRepository();
  const service = createPlanService(repository);

  const result = await service.listPlans();

  assert.deepEqual(result, [{ slug: "a" }, { slug: "b" }]);
  assert.deepEqual(calls, [["list"]]);
});

test("readPlan delegates to repository.read", async () => {
  const { repository, calls } = createFakeRepository();
  const service = createPlanService(repository);

  const content = await service.readPlan("/plans/p1.md");

  assert.equal(content, "content:/plans/p1.md");
  assert.deepEqual(calls, [["read", "/plans/p1.md"]]);
});

test("updatePlanStatus delegates with exact arguments", async () => {
  const { repository, calls } = createFakeRepository();
  const service = createPlanService(repository);

  await service.updatePlanStatus("/plans/p1.md", "in-progress");

  assert.deepEqual(calls, [["updateStatus", "/plans/p1.md", "in-progress"]]);
});

test("assignPlanSession delegates with exact arguments", async () => {
  const { repository, calls } = createFakeRepository();
  const service = createPlanService(repository);

  await service.assignPlanSession("/plans/p1.md", "session-1");

  assert.deepEqual(calls, [["assignSession", "/plans/p1.md", "session-1"]]);
});

test("clearPlanSession delegates with exact arguments", async () => {
  const { repository, calls } = createFakeRepository();
  const service = createPlanService(repository);

  await service.clearPlanSession("/plans/p1.md");

  assert.deepEqual(calls, [["clearSessionAssignment", "/plans/p1.md"]]);
});

test("deletePlan delegates with exact arguments", async () => {
  const { repository, calls } = createFakeRepository();
  const service = createPlanService(repository);

  await service.deletePlan("/plans/p1.md");

  assert.deepEqual(calls, [["delete", "/plans/p1.md"]]);
});

test("suggestNextPlan returns 01-01 on empty/legacy repository", async () => {
  const { repository } = createFakeRepository({
    list: async () => [{ filename: "legacy-plan.md", slug: "legacy-plan" }] as never,
  });
  const service = createPlanService(repository);

  const suggestion = await service.suggestNextPlan();

  assert.equal(suggestion.recommendedFilenamePrefix, "01-01");
  assert.deepEqual(suggestion.recommendedDependencies, []);
  assert.equal(suggestion.alternativeNewPhaseFilenamePrefix, "02-01");
});

test("suggestNextPlan increments latest semantic plan in same phase", async () => {
  const { repository } = createFakeRepository({
    list: async () => [
      { filename: "01-01-foundation.md", slug: "01-01-foundation", phase: "01-strict-planning" },
      { filename: "01-02-ux.md", slug: "01-02-ux", phase: "01-strict-planning" },
    ] as never,
  });
  const service = createPlanService(repository);

  const suggestion = await service.suggestNextPlan();

  assert.equal(suggestion.latestPlan, "01-02-ux.md");
  assert.equal(suggestion.recommendedFilenamePrefix, "01-03");
  assert.deepEqual(suggestion.recommendedDependencies, ["01-02-ux"]);
  assert.equal(suggestion.alternativeNewPhaseFilenamePrefix, "02-01");
});

test("suggestNextPlan follows highest phase/plan combination", async () => {
  const { repository } = createFakeRepository({
    list: async () => [
      { filename: "01-10-a.md", slug: "01-10-a" },
      { filename: "02-01-b.md", slug: "02-01-b" },
      { filename: "01-99-c.md", slug: "01-99-c" },
    ] as never,
  });
  const service = createPlanService(repository);

  const suggestion = await service.suggestNextPlan();

  assert.equal(suggestion.recommendedFilenamePrefix, "02-02");
  assert.deepEqual(suggestion.recommendedDependencies, ["02-01-b"]);
  assert.equal(suggestion.alternativeNewPhaseFilenamePrefix, "03-01");
});

test("service propagates repository errors", async () => {
  const expected = new Error("boom");
  const { repository } = createFakeRepository({
    updateStatus: async () => {
      throw expected;
    },
  });
  const service = createPlanService(repository);

  await assert.rejects(
    () => service.updatePlanStatus("/plans/p1.md", "in-progress"),
    expected,
  );
});
