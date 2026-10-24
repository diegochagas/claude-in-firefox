// Pure DOM rendering of the popup from a BridgeStatus; tested under jsdom.
import type { BridgeStatus, DrivenTabStatus } from "../shared/popup-protocol";

export const USAGE_HINT =
  "Open chat for a sidebar conversation with Claude about the current page (uses your Claude Code login). Claude Code sessions can also drive this browser directly; the tools are named claude-in-firefox.";
const NOT_CONNECTED_HINT =
  "Not connected: the native host is not running. Run scripts/setup once in the claude-in-firefox checkout, then press Reconnect.";

function requireElement(root: ParentNode, id: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`#${id}`);
  if (!element) throw new Error(`popup is missing #${id}: expected the ids from popup.html`);
  return element;
}

function tabItem(document: Document, tab: DrivenTabStatus): HTMLLIElement {
  const item = document.createElement("li");
  item.textContent = tab.title || "(untitled)";
  const url = document.createElement("span");
  url.textContent = ` ${tab.url}`;
  item.append(url);
  item.title = tab.url;
  return item;
}

/** Fill the popup's elements from a status snapshot. */
export function renderPopup(root: Document, status: BridgeStatus): void {
  requireElement(root, "version").textContent = `v${status.version}`;
  requireElement(root, "dot").classList.toggle("connected", status.connected);
  requireElement(root, "state").textContent = status.connected
    ? "Connected to Claude Code"
    : "Not connected";
  requireElement(root, "detail").textContent = status.detail;
  const list = requireElement(root, "tabs");
  list.replaceChildren(...status.drivenTabs.map((tab) => tabItem(root, tab)));
  if (status.drivenTabs.length === 0) {
    const none = root.createElement("li");
    none.textContent = "none yet in this browser session";
    list.append(none);
  }
  requireElement(root, "hint").textContent = status.connected ? USAGE_HINT : NOT_CONNECTED_HINT;
}
