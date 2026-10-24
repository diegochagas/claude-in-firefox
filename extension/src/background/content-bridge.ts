// Sends a command to the content script of a tab, injecting it first when the tab was open
// before the extension loaded (temporary add-ons installed mid-session).
import type { ContentCommand } from "../shared/protocol";

const NO_RECEIVER = /Receiving end does not exist|Could not establish connection/i;

async function describeTab(tabId: number): Promise<string> {
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  return tab ? `${tabId} (${tab.url ?? "no url"})` : String(tabId);
}

async function injectContentScript(tabId: number): Promise<void> {
  try {
    await browser.tabs.executeScript(tabId, { file: "content.js", runAt: "document_start" });
  } catch (error) {
    throw new Error(
      `cannot access tab ${await describeTab(tabId)}: Firefox blocks extensions on about:, moz-extension:, addons.mozilla.org and the PDF viewer (${String(error)})`,
    );
  }
}

/** Run a ContentCommand in a tab and return its result. */
export async function sendToContent<T = unknown>(
  tabId: number,
  command: ContentCommand,
): Promise<T> {
  try {
    return (await browser.tabs.sendMessage(tabId, command)) as T;
  } catch (error) {
    if (!NO_RECEIVER.test(String(error))) throw error;
    await injectContentScript(tabId);
    return (await browser.tabs.sendMessage(tabId, command)) as T;
  }
}
