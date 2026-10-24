// Keeps the native-messaging port to the host process open, answering requests and
// reconnecting with backoff when Firefox drops it (host crash, manifest missing).
import type { BridgeRequest, BridgeResponse } from "../shared/protocol";

export const NATIVE_HOST_NAME = "claude_in_firefox";
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;
type StatusListener = (connected: boolean, detail: string) => void;

export class NativeHostLink {
  private port: browser.runtime.Port | undefined;
  private reconnectDelay = RECONNECT_MIN_MS;

  constructor(
    private readonly handleRequest: RequestHandler,
    private readonly onStatus: StatusListener,
  ) {}

  /** Drop the current port (if any) and connect again right away; used by the popup's Reconnect. */
  reconnectNow(): void {
    this.reconnectDelay = RECONNECT_MIN_MS;
    if (this.port) {
      const port = this.port;
      this.port = undefined;
      port.disconnect();
    }
    this.connect();
  }

  connect(): void {
    const port = browser.runtime.connectNative(NATIVE_HOST_NAME);
    this.port = port;
    port.onMessage.addListener((message: unknown) => void this.answer(message as BridgeRequest));
    port.onDisconnect.addListener(() => this.handleDisconnect(port));
    this.onStatus(true, "native host connected");
  }

  private handleDisconnect(port: browser.runtime.Port): void {
    // A port we dropped on purpose (reconnectNow) must not schedule a second reconnect.
    if (this.port !== port) return;
    const reason = port.error?.message ?? "host exited";
    this.port = undefined;
    this.onStatus(false, `disconnected: ${reason}; retrying in ${this.reconnectDelay / 1000}s`);
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private async answer(request: BridgeRequest): Promise<void> {
    this.reconnectDelay = RECONNECT_MIN_MS;
    const response: BridgeResponse = { id: request.id };
    try {
      response.result = await this.handleRequest(request.method, request.params);
    } catch (error) {
      response.error = error instanceof Error ? error.message : String(error);
    }
    this.port?.postMessage(response);
  }
}
