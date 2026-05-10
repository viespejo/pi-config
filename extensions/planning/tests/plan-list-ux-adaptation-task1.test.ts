import assert from "node:assert/strict";
import test from "node:test";

import { buildPlanForest } from "../lib/plan-selector.ts";
import type { PlanInfo, PlanStatus } from "../lib/types.ts";

function mkPlan(
  slug: string,
  dependencies: string[] = [],
  status: PlanStatus = "pending",
): PlanInfo {
  return {
    filename: `${slug}.md`,
    path: `/tmp/${slug}.md`,
    slug,
    date: "2026-01-01",
    title: slug,
    directory: "/tmp",
    status,
    dependencies,
    dependents: [],
  };
}

test("buildPlanForest skips synthetic missing nodes and keeps real plan as root", () => {
  const plans = [mkPlan("01-01", ["missing-dep"])];

  const roots = buildPlanForest(plans);

  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.slug, "01-01");
  assert.equal(roots[0]?.children.length, 0);
});

test("buildPlanForest keeps pure cycle component reachable via a single additional root", () => {
  const plans = [mkPlan("A", ["B"]), mkPlan("B", ["A"]), mkPlan("R", [])];

  const roots = buildPlanForest(plans);
  const rootSlugs = roots.map((r) => r.slug);

  assert.ok(rootSlugs.includes("R"));

  const cycleRoots = rootSlugs.filter((slug) => slug === "A" || slug === "B");
  assert.equal(cycleRoots.length, 1);
});

