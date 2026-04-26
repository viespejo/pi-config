/**
 * Lightweight telemetry for plan lifecycle events.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface PlanTelemetryEvent {
  timestamp: string;
  action:
    | "status_transition"
    | "assignment_set"
    | "assignment_cleared"
    | "execute_started";
  planPath: string;
  planSlug: string;
  from?: string;
  to?: string;
  sessionId?: string;
}

const EVENTS_FILE = ".plan-events.ndjson";

export async function appendPlanTelemetryEvent(
  plansDir: string,
  event: PlanTelemetryEvent,
): Promise<void> {
  const eventsPath = path.join(plansDir, EVENTS_FILE);
  const line = `${JSON.stringify(event)}\n`;

  try {
    await fs.mkdir(plansDir, { recursive: true });
    await fs.appendFile(eventsPath, line, "utf-8");
  } catch {
    // Best effort only. Never block workflow on telemetry I/O.
  }
}
