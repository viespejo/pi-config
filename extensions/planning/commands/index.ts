import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { setupExecutePlanCommand } from "./execute-plan";
import { setupListPlansCommand } from "./list-plans";
import { setupSaveAsPlanCommand } from "./save-as-plan";

export function setupPlanningCommands(pi: ExtensionAPI) {
  setupListPlansCommand(pi);
  setupExecutePlanCommand(pi);
  setupSaveAsPlanCommand(pi);
}
