import * as path from "node:path";

export function buildPlanSummaryFilename(planFilename: string): string {
  return planFilename.replace(/\.md$/i, "-SUMMARY.md");
}

export function buildPlanSummaryPath(planPath: string): string {
  return path.join(
    path.dirname(planPath),
    buildPlanSummaryFilename(path.basename(planPath)),
  );
}
