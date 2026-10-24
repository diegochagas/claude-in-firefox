// Maps BridgeMethod names to background handlers. Every handler returns JSON-serialisable data.
import type { BridgeMethod, ContentCommand } from "../shared/protocol";
import { resolveTabId } from "./active-tab";
import { readChatTranscript, sendChatTurn } from "./chat-api";
import { readConsole } from "./console-store";
import { sendToContent } from "./content-bridge";
import { settleAfterInteraction } from "./navigation-wait";
import { readNetwork } from "./network-store";
import { captureViewport, captureZoom } from "./screenshot";
import { closeTab, createTab, listTabs, navigateTab, resizeViewport } from "./tab-commands";

type Params = Record<string, unknown>;
type Handler = (params: Params) => Promise<unknown>;

function contentCommand(kind: ContentCommand["kind"], params: Params): ContentCommand {
  const rest = { ...params };
  delete rest.tabId;
  return { kind, ...rest } as ContentCommand;
}

async function forwardToPage(kind: ContentCommand["kind"], params: Params): Promise<unknown> {
  const tabId = await resolveTabId(params.tabId);
  return sendToContent(tabId, contentCommand(kind, params));
}

async function interactWithPage(kind: "pointer" | "keyboard", params: Params): Promise<string> {
  const tabId = await resolveTabId(params.tabId);
  const outcome = await sendToContent<string>(tabId, contentCommand(kind, params));
  return outcome + (await settleAfterInteraction(tabId));
}

const HANDLERS: Record<BridgeMethod, Handler> = {
  "tabs.list": () => listTabs(),
  "tabs.create": (params) => createTab(params.url),
  "tabs.close": (params) => closeTab(params.tabId),
  "tabs.navigate": (params) => navigateTab(params.tabId, params.url),
  "tabs.resize": (params) => resizeViewport(params),
  "page.screenshot": (params) => captureViewport(params.tabId, params.scale),
  "page.zoom": (params) => captureZoom(params.tabId, params.region, params.scale),
  "page.read": (params) => forwardToPage("read", params),
  "page.find": (params) => forwardToPage("find", params),
  "page.text": (params) => forwardToPage("text", params),
  "page.formInput": (params) => forwardToPage("formInput", params),
  "page.pointer": (params) => interactWithPage("pointer", params),
  "page.keyboard": (params) => interactWithPage("keyboard", params),
  "page.scroll": (params) => forwardToPage("scroll", params),
  "page.scrollTo": (params) => forwardToPage("scrollTo", params),
  "page.evaluate": (params) => forwardToPage("evaluate", params),
  "diagnostics.console": (params) => readConsole(params),
  "diagnostics.network": (params) => readNetwork(params),
  "chat.send": (params) => sendChatTurn(params.text, params.model, params.conversationId),
  "chat.transcript": (params) => Promise.resolve(readChatTranscript(params.conversationId)),
};

/** Dispatch one bridge request; unknown methods fail with the list of valid ones. */
export function dispatchBridgeRequest(method: string, params: Params): Promise<unknown> {
  const handler = HANDLERS[method as BridgeMethod];
  if (!handler)
    return Promise.reject(
      new Error(
        `unknown bridge method "${method}": expected one of ${Object.keys(HANDLERS).join(", ")}`,
      ),
    );
  return handler(params ?? {});
}
