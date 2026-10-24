import { z } from "zod";
import type { TabSummary } from "../../../extension/src/shared/protocol";
import type { BridgeRequester } from "../bridge-client";
import { textResult, type ToolRegistry } from "../tool-registry";

export function formatTabs(tabs: TabSummary[]): string {
  if (tabs.length === 0) return "no tabs open";
  return tabs
    .map(
      (tab) =>
        `${tab.active ? "* " : "  "}tabId=${tab.tabId} window=${tab.windowId} [${tab.status}] ${JSON.stringify(tab.title)} ${tab.url}`,
    )
    .join("\n");
}

function registerTabsContext(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "tabs_context",
    description:
      "List every Firefox tab with its tabId, window, title and URL; the active tab is marked with *. Call it first to pick a tabId for the other tools (they default to the active tab when tabId is omitted).",
    shape: {},
    run: async () => textResult(formatTabs(await bridge.request<TabSummary[]>("tabs.list"))),
  });
}

function registerTabsCreateClose(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "tabs_create",
    description: "Open a new tab, blank or at a URL, and return its tabId.",
    shape: { url: z.string().optional().describe("URL to open; omit for a blank tab") },
    run: async ({ url }) =>
      textResult(formatTabs([await bridge.request<TabSummary>("tabs.create", { url })])),
  });
  registry.define({
    name: "tabs_close",
    description: "Close one tab.",
    shape: { tabId: z.number().describe("Tab to close (from tabs_context)") },
    run: async ({ tabId }) => textResult(await bridge.request<string>("tabs.close", { tabId })),
  });
}

export function registerTabTools(registry: ToolRegistry, bridge: BridgeRequester): void {
  registerTabsContext(registry, bridge);
  registerTabsCreateClose(registry, bridge);
}
