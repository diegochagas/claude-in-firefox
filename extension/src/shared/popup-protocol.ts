// Messages between the toolbar popup and the background page.

export interface DrivenTabStatus {
  tabId: number;
  title: string;
  url: string;
}

export interface BridgeStatus {
  version: string;
  connected: boolean;
  detail: string;
  drivenTabs: DrivenTabStatus[];
}

export interface PopupStatusRequest {
  kind: "popupStatus";
}

export interface PopupReconnectRequest {
  kind: "popupReconnect";
}

export type PopupRequest = PopupStatusRequest | PopupReconnectRequest;

export function isPopupRequest(message: unknown): message is PopupRequest {
  const kind = (message as PopupRequest | null)?.kind;
  return kind === "popupStatus" || kind === "popupReconnect";
}
