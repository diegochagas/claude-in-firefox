import type { TabSummary } from "../shared/protocol";
import { markTabDriven } from "./driven-tabs";

export function summarizeTab(tab: browser.tabs.Tab): TabSummary {
  return {
    tabId: tab.id ?? -1,
    windowId: tab.windowId ?? -1,
    url: tab.url ?? "",
    title: tab.title ?? "",
    active: tab.active,
    status: tab.status ?? "unknown",
  };
}

/** The tab a command targets: the given id, else the active tab of the last focused window. */
export async function resolveTabId(tabId: unknown): Promise<number> {
  if (typeof tabId === "number") {
    await browser.tabs.get(tabId).catch(() => {
      throw new Error(`tab ${tabId} does not exist: call tabs_context for the current tab ids`);
    });
    markTabDriven(tabId);
    return tabId;
  }
  const [active] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  const fallback = active ?? (await browser.tabs.query({ active: true }))[0];
  if (fallback?.id === undefined)
    throw new Error("no active tab: open a tab with tabs_create first");
  markTabDriven(fallback.id);
  return fallback.id;
}
