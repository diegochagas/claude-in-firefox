import type { TabSummary, ViewportInfo } from "../shared/protocol";
import { resolveTabId, summarizeTab } from "./active-tab";
import { sendToContent } from "./content-bridge";
import { waitForNavigationStart, waitForTabLoad } from "./navigation-wait";

const NAVIGATION_TIMEOUT_MS = 30_000;
const VIEWPORT_PRESETS: Record<string, { width: number; height: number } | null> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: null,
};
const originalWindowSizes = new Map<number, { width: number; height: number }>();

export async function listTabs(): Promise<TabSummary[]> {
  const tabs = await browser.tabs.query({});
  return tabs.map(summarizeTab);
}

export async function createTab(url: unknown): Promise<TabSummary> {
  const tab = await browser.tabs.create({
    url: typeof url === "string" ? normalizeUrl(url) : "about:blank",
    active: true,
  });
  if (tab.id !== undefined && typeof url === "string")
    await waitForTabLoad(tab.id, NAVIGATION_TIMEOUT_MS);
  return summarizeTab(tab.id === undefined ? tab : await browser.tabs.get(tab.id));
}

export async function closeTab(tabId: unknown): Promise<string> {
  const id = await resolveTabId(tabId);
  await browser.tabs.remove(id);
  return `closed tab ${id}`;
}

/** Add a scheme when the model passes a bare host ("example.com", "localhost:3000"). */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  // "localhost:3000" looks like a scheme but is host:port; only real schemes pass through.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^(about|data|mailto|javascript|view-source|blob|file|moz-extension|chrome):/i.test(trimmed))
    return trimmed;
  const scheme = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(trimmed) ? "http" : "https";
  return `${scheme}://${trimmed}`;
}

export async function navigateTab(
  tabId: unknown,
  url: unknown,
): Promise<TabSummary & { loaded: boolean }> {
  if (typeof url !== "string" || !url)
    throw new Error(`navigate needs a url string: got ${JSON.stringify(url)}`);
  const id = await resolveTabId(tabId);
  if (url === "back") await browser.tabs.goBack(id);
  else if (url === "forward") await browser.tabs.goForward(id);
  else await browser.tabs.update(id, { url: normalizeUrl(url) });
  // goBack/goForward resolve before the tab flips to "loading"; wait for the flip first.
  await waitForNavigationStart(id, 1_500);
  const loaded = await waitForTabLoad(id, NAVIGATION_TIMEOUT_MS);
  return { ...summarizeTab(await browser.tabs.get(id)), loaded };
}

interface ResizeParams {
  tabId?: unknown;
  preset?: string;
  width?: number;
  height?: number;
}

function targetViewport(params: ResizeParams): { width: number; height: number } | null {
  if (params.preset) {
    const preset = VIEWPORT_PRESETS[params.preset];
    if (preset === undefined)
      throw new Error(`unknown preset "${params.preset}": expected mobile, tablet or desktop`);
    return preset;
  }
  if (typeof params.width === "number" && typeof params.height === "number")
    return { width: params.width, height: params.height };
  throw new Error("resize needs a preset or both width and height");
}

/** Resize the tab's window so the page viewport matches the requested size. */
export async function resizeViewport(params: ResizeParams): Promise<string> {
  const id = await resolveTabId(params.tabId);
  const tab = await browser.tabs.get(id);
  const windowId = tab.windowId ?? browser.windows.WINDOW_ID_CURRENT;
  const target = targetViewport(params);
  if (!target) return restoreWindow(windowId);
  const current = await browser.windows.get(windowId);
  rememberOriginalSize(windowId, current);
  const viewport = await sendToContent<ViewportInfo>(id, { kind: "viewport" });
  const width = target.width + (current.width ?? viewport.width) - viewport.width;
  const height = target.height + (current.height ?? viewport.height) - viewport.height;
  await browser.windows.update(windowId, { width, height, state: "normal" });
  return `viewport resized to ${target.width}×${target.height} (window ${width}×${height})`;
}

function rememberOriginalSize(windowId: number, current: browser.windows.Window): void {
  if (originalWindowSizes.has(windowId)) return;
  originalWindowSizes.set(windowId, {
    width: current.width ?? 1280,
    height: current.height ?? 800,
  });
}

async function restoreWindow(windowId: number): Promise<string> {
  const original = originalWindowSizes.get(windowId);
  if (!original) return "window size unchanged (no emulation active)";
  await browser.windows.update(windowId, original);
  originalWindowSizes.delete(windowId);
  return `window restored to ${original.width}×${original.height}`;
}
