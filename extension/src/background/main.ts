// Background entry: connects to the native host and serves bridge requests.
import { receiveChatEvent, recordChatHostStatus, startChatApi } from "./chat-api";
import { dispatchBridgeRequest } from "./command-router";
import { startConsoleStore } from "./console-store";
import { NativeHostLink } from "./native-port";
import { startNavigationTracker } from "./navigation-wait";
import { startNetworkStore } from "./network-store";
import { recordHostStatus, startPopupApi } from "./popup-api";

function showStatus(connected: boolean, detail: string): void {
  recordHostStatus(connected, detail);
  recordChatHostStatus(connected);
  void browser.browserAction.setBadgeText({ text: connected ? "on" : "off" });
  void browser.browserAction.setBadgeBackgroundColor({ color: connected ? "#2e7d32" : "#9e9e9e" });
  void browser.browserAction.setTitle({ title: `Claude Browser Bridge: ${detail}` });
  console.info(JSON.stringify({ event: "native-host-status", connected, detail }));
}

startConsoleStore();
startNetworkStore();
startNavigationTracker();
const hostLink = new NativeHostLink(dispatchBridgeRequest, showStatus, receiveChatEvent);
startPopupApi(() => hostLink.reconnectNow());
startChatApi((command) => hostLink.sendChatCommand(command));
hostLink.connect();
