import { z } from "zod";
import type { TabSummary } from "../../../extension/src/shared/protocol";
import type { BridgeRequester } from "../bridge-client";
import { textResult, type ToolRegistry } from "../tool-registry";

type NavigationOutcome = TabSummary & { loaded: boolean };

export function formatNavigation(outcome: NavigationOutcome): string {
  const state = outcome.loaded ? "loaded" : "still loading after 30s";
  return `tabId=${outcome.tabId} ${state}: ${JSON.stringify(outcome.title)} ${outcome.url}`;
}

export function registerNavigateTool(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "navigate",
    description:
      'Navigate a tab to a URL (a bare host gets https://), or go "back" / "forward" in its history. Waits for the page to finish loading.',
    shape: {
      url: z.string().describe('URL to open, or "back" / "forward"'),
      tabId: z.number().optional().describe("Tab to navigate; defaults to the active tab"),
    },
    run: async ({ url, tabId }) =>
      textResult(
        formatNavigation(
          await bridge.request<NavigationOutcome>("tabs.navigate", { url, tabId }, 45_000),
        ),
      ),
  });
}
