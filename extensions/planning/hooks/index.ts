/**
 * Planning extension hooks
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { setupSessionStartHook } from "./session-start";
import { setupSessionSwitchHook } from "./session-switch";

export function setupPlanningHooks(pi: ExtensionAPI) {
  setupSessionStartHook(pi);
  setupSessionSwitchHook(pi);
}
