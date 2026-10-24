// Waiting for pages to finish loading after navigations and interactions.

const POLL_MS = 100;
const NAVIGATION_START_GRACE_MS = 600;
const INTERACTION_LOAD_TIMEOUT_MS = 8_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve when the tab reports status "complete", or false when the timeout passes first. */
export async function waitForTabLoad(tabId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (!tab) throw new Error(`tab ${tabId} was closed while loading`);
    if (tab.status === "complete") return true;
    await sleep(POLL_MS);
  }
  return false;
}

/** Wait until the tab reports "loading" (a navigation began), or give up after timeoutMs. */
export async function waitForNavigationStart(tabId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (tab?.status === "loading") return true;
    await sleep(50);
  }
  return false;
}

/** After a click or key press: give the page a moment, then wait for any navigation it started. */
export async function settleAfterInteraction(tabId: number): Promise<string> {
  // Form submissions and link clicks can take a few hundred ms to flip the tab to "loading".
  const navigating = await waitForNavigationStart(tabId, NAVIGATION_START_GRACE_MS);
  if (!navigating) return "";
  const loaded = await waitForTabLoad(tabId, INTERACTION_LOAD_TIMEOUT_MS);
  const after = await browser.tabs.get(tabId).catch(() => undefined);
  return loaded
    ? `; page navigated to ${after?.url ?? "?"}`
    : `; page still loading ${after?.url ?? "?"}`;
}
