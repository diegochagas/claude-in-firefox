// Answers the toolbar popup: current native-host status, the tabs Claude has driven, reconnect.
import { isPopupRequest, type BridgeStatus, type DrivenTabStatus } from "../shared/popup-protocol";
import { listDrivenTabIds } from "./driven-tabs";

let lastStatus = { connected: false, detail: "starting" };

/** Remember the latest native-host status; the popup reads it on open. */
export function recordHostStatus(connected: boolean, detail: string): void {
  lastStatus = { connected, detail };
}

async function describeDrivenTabs(): Promise<DrivenTabStatus[]> {
  const tabs = await Promise.all(
    listDrivenTabIds().map((id) => browser.tabs.get(id).catch(() => undefined)),
  );
  return tabs
    .filter((tab): tab is browser.tabs.Tab => tab?.id !== undefined)
    .map((tab) => ({ tabId: tab.id!, title: tab.title ?? "", url: tab.url ?? "" }));
}

async function currentStatus(): Promise<BridgeStatus> {
  return {
    version: browser.runtime.getManifest().version,
    connected: lastStatus.connected,
    detail: lastStatus.detail,
    drivenTabs: await describeDrivenTabs(),
  };
}

/** Serve popup messages; `reconnect` is the NativeHostLink's reconnectNow. */
export function startPopupApi(reconnect: () => void): void {
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.tab || !isPopupRequest(message)) return undefined;
    if (message.kind === "popupReconnect") reconnect();
    return currentStatus();
  });
}
