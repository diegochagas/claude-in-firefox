// Background entry: connects to the native host and serves bridge requests.
import { dispatchBridgeRequest } from "./command-router";
import { startConsoleStore } from "./console-store";
import { NativeHostLink } from "./native-port";
import { startNetworkStore } from "./network-store";

function showStatus(connected: boolean, detail: string): void {
  void browser.browserAction.setBadgeText({ text: connected ? "on" : "off" });
  void browser.browserAction.setBadgeBackgroundColor({ color: connected ? "#2e7d32" : "#9e9e9e" });
  void browser.browserAction.setTitle({ title: `Claude in Firefox: ${detail}` });
  console.info(JSON.stringify({ event: "native-host-status", connected, detail }));
}

startConsoleStore();
startNetworkStore();
new NativeHostLink(dispatchBridgeRequest, showStatus).connect();
