/**
 * Planning Extension
 *
 * Commands for creating and executing implementation plans.
 *
 * Commands:
 * - /plan:save [instructions] - Create plan from conversation
 * - /plan:execute - Select and execute a plan
 *
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setupPlanningCommands } from "./commands";
import {
  deactivatePlanLogTool,
} from "./lib/plan-execution-runtime";
import { setupPlanLogTaskTerminalTool } from "./lib/tools/plan-log-task-terminal-tool";
// import { setupPlanningHooks } from "./hooks";

export default function (pi: ExtensionAPI) {
  setupPlanLogTaskTerminalTool(pi);
  setupPlanningCommands(pi);

  pi.on("session_start", async () => {
    deactivatePlanLogTool(pi);
  });

  pi.on("session_before_switch", async () => {
    deactivatePlanLogTool(pi);
  });

  // setupPlanningHooks(pi);
}
