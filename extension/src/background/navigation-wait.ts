// Waiting for pages to finish loading after navigations and interactions. Tab status alone is
// not enough: after goBack (bfcache) or a fast form submit the tab can report "complete" with a
// stale URL for a moment, so navigations are tracked from webNavigation events (phase per tab)
// and a load counts as finished only when no tracked navigation is still in flight.

const POLL_MS = 100;
const INTERACTION_LOAD_TIMEOUT_MS = 8_000;
const NAVIGATION_START_GRACE_MS = 600;

type NavigationPhase = "navigating" | "committed" | "done";
const phaseByTab = new Map<number, NavigationPhase>();
const phaseWaiters = new Map<number, Set<() => void>>();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setPhase(tabId: number, phase: NavigationPhase): void {
  phaseByTab.set(tabId, phase);
  for (const wake of phaseWaiters.get(tabId) ?? []) wake();
}

function topFrameListener(phase: NavigationPhase) {
  return (details: { tabId: number; frameId: number }) => {
    if (details.frameId === 0) setPhase(details.tabId, phase);
  };
}

/** Register the webNavigation listeners; call once from the background entry. */
export function startNavigationTracker(): void {
  browser.webNavigation.onBeforeNavigate.addListener(topFrameListener("navigating"));
  browser.webNavigation.onCommitted.addListener(topFrameListener("committed"));
  browser.webNavigation.onCompleted.addListener(topFrameListener("done"));
  browser.webNavigation.onErrorOccurred.addListener(topFrameListener("done"));
  browser.tabs.onRemoved.addListener((tabId) => {
    phaseByTab.delete(tabId);
    phaseWaiters.delete(tabId);
  });
}

/** Resolve true on the next phase change of the tab, false when timeoutMs passes first. */
function waitForPhaseChange(tabId: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const waiters = phaseWaiters.get(tabId) ?? new Set<() => void>();
    phaseWaiters.set(tabId, waiters);
    const finish = (changed: boolean) => {
      clearTimeout(timer);
      waiters.delete(wake);
      resolve(changed);
    };
    const wake = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    waiters.add(wake);
  });
}

function navigationInFlight(tabId: number): boolean {
  const phase = phaseByTab.get(tabId);
  return phase === "navigating" || phase === "committed";
}

/** Resolve when the tab has no navigation in flight and reports "complete"; false on timeout. */
export async function waitForTabLoad(tabId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (!tab) throw new Error(`tab ${tabId} was closed while loading`);
    if (tab.status === "complete" && !navigationInFlight(tabId)) return true;
    await sleep(POLL_MS);
  }
  return false;
}

/**
 * Resolve true as soon as a top-frame navigation starts in the tab (or one is already in
 * flight), false once timeoutMs passes with none. Event-driven: clicks that do not navigate
 * wait the grace period without polling.
 */
export async function waitForNavigationStart(tabId: number, timeoutMs: number): Promise<boolean> {
  if (navigationInFlight(tabId)) return true;
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  if (tab?.status === "loading") return true;
  return waitForPhaseChange(tabId, timeoutMs);
}

/** After a click or key press: wait briefly for a navigation to start, then for it to finish. */
export async function settleAfterInteraction(tabId: number): Promise<string> {
  const navigating = await waitForNavigationStart(tabId, NAVIGATION_START_GRACE_MS);
  if (!navigating) return "";
  const loaded = await waitForTabLoad(tabId, INTERACTION_LOAD_TIMEOUT_MS);
  const after = await browser.tabs.get(tabId).catch(() => undefined);
  return loaded
    ? `; page navigated to ${after?.url ?? "?"}`
    : `; page still loading ${after?.url ?? "?"}`;
}
