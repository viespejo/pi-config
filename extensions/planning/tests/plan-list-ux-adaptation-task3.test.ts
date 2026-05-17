import assert from "node:assert/strict";
import test from "node:test";

import { selectPlan } from "../lib/plan-selector.ts";
import type { PlanInfo, PlanStatus } from "../lib/types.ts";

function mkPlan(slug: string, status: PlanStatus, title: string): PlanInfo {
  return {
    filename: `${slug}.md`,
    path: `/tmp/${slug}.md`,
    slug,
    date: "2026-01-01",
    title,
    directory: "/tmp",
    status,
    dependencies: [],
    dependents: [],
  };
}

test("default selector render keeps paused and legacy terminal statuses visible", async () => {
  const plans: PlanInfo[] = [
    mkPlan("01-00", "paused", "Paused plan"),
    mkPlan("01-01", "completed", "Completed plan"),
    mkPlan("01-02", "cancelled", "Cancelled plan"),
    mkPlan("01-03", "abandoned", "Abandoned plan"),
  ];

  let rendered = "";

  const ctx = {
    hasUI: true,
    ui: {
      custom: async (factory: any) => {
        const component = factory(
          { requestRender: () => {} },
          {
            fg: (_: string, s: string) => s,
            bold: (s: string) => s,
          },
          { matches: () => false },
          () => {},
        );
        rendered = component.render(140).join("\n");
        return { selected: null };
      },
    },
  } as any;

  await selectPlan(ctx, plans);

  assert.match(rendered, /Paused plan/);
  assert.match(rendered, /Completed plan/);
  assert.match(rendered, /Cancelled plan/);
  assert.match(rendered, /Abandoned plan/);
  assert.match(rendered, /paused/);
  assert.match(rendered, /completed/);
  assert.match(rendered, /cancelled/);
  assert.match(rendered, /abandoned/);
});

test("selector render does not overflow stack on cyclic dependencies", async () => {
  const plans: PlanInfo[] = [
    {
      ...mkPlan("03-02", "pending", "Cycle A"),
      dependencies: ["03-03"],
    },
    {
      ...mkPlan("03-03", "pending", "Cycle B"),
      dependencies: ["03-02"],
    },
  ];

  const ctx = {
    hasUI: true,
    ui: {
      custom: async (factory: any) => {
        const component = factory(
          { requestRender: () => {} },
          {
            fg: (_: string, s: string) => s,
            bold: (s: string) => s,
          },
          { matches: () => false },
          () => {},
        );
        const rendered = component.render(140).join("\n");
        assert.match(rendered, /Cycle A/);
        assert.match(rendered, /Cycle B/);
        return { selected: null };
      },
    },
  } as any;

  await assert.doesNotReject(() => selectPlan(ctx, plans));
});
