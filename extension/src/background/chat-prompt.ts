// Builds the prompt Claude receives for a sidebar turn: the user's words plus the tab they are
// looking at, so the first tool call targets the right page without a tabs_context round trip.
import { redactUrl } from "./redact-url";

export interface ContextTab {
  tabId: number;
  title: string;
  url: string;
}

/**
 * Example: composeChatPrompt("What is this?", { tabId: 4, title: "Docs", url: "https://d.test" }, true)
 *   → "<firefox_context>…tabId=4…</firefox_context>\n\nWhat is this?"
 */
export function composeChatPrompt(
  text: string,
  tab: ContextTab | undefined,
  firstTurn: boolean,
): string {
  if (!tab) return text;
  const where = `tabId=${tab.tabId} "${tab.title}" ${redactUrl(tab.url)}`;
  const guidance = firstTurn
    ? ` Use tabId=${tab.tabId} with the claude-in-firefox tools for this page; call tabs_context only if you need other tabs.`
    : "";
  return `<firefox_context>The user is looking at ${where}.${guidance}</firefox_context>\n\n${text}`;
}

function isBrowserPage(url: string | undefined): boolean {
  return !!url && !url.startsWith("moz-extension:") && !url.startsWith("about:");
}

/**
 * The tab the user means: the active one, unless that is an extension or about: page (the
 * sidebar itself opened in a tab, a new-tab page), then the most recently used web page tab.
 */
export async function pickContextTab(): Promise<ContextTab | undefined> {
  const [active] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  const candidates = isBrowserPage(active?.url)
    ? [active!]
    : (await browser.tabs.query({ windowId: active?.windowId }))
        .filter((tab) => isBrowserPage(tab.url))
        .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const tab = candidates[0];
  if (tab?.id === undefined) return undefined;
  return { tabId: tab.id, title: tab.title ?? "", url: tab.url ?? "" };
}
