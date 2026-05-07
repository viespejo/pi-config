/**
 * Session switch hook - clear plan execution widget
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function setupSessionSwitchHook(pi: ExtensionAPI) {
  pi.on("session_before_switch", async (_event, ctx) => {
    ctx.ui.setWidget("plan-execution", undefined);
  });
}
