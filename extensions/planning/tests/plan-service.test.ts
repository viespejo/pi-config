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
