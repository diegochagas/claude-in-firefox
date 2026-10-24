// Toolbar popup entry: asks the background for the status and renders it.
import type { BridgeStatus } from "../shared/popup-protocol";
import { renderPopup } from "./render";

async function refresh(kind: "popupStatus" | "popupReconnect"): Promise<void> {
  const status = (await browser.runtime.sendMessage({ kind })) as BridgeStatus;
  renderPopup(document, status);
}

// sidebarAction.open() only works inside a user gesture: the click handler itself.
document.getElementById("open-chat")?.addEventListener("click", () => {
  browser.sidebarAction.open().finally(() => window.close());
});
document.getElementById("reconnect")?.addEventListener("click", () => {
  void refresh("popupReconnect");
});
void refresh("popupStatus");
