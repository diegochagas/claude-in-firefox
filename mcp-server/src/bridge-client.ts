// Connects to the native host's Unix socket and exchanges JSON lines with it.
import { connect, type Socket } from "node:net";
import type {
  BridgeMethod,
  BridgeRequest,
  BridgeResponse,
} from "../../extension/src/shared/protocol";
import { LineReader } from "../../native-host/src/line-reader";
import { bridgeSocketPath } from "../../native-host/src/socket-path";

const DEFAULT_TIMEOUT_MS = 60_000;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class FirefoxNotConnectedError extends Error {
  constructor(socketPath: string, cause: string) {
    super(
      `Firefox is not connected (${cause} at ${socketPath}). Open Firefox with the "Claude Browser Bridge" extension enabled; its toolbar badge shows "on" when the native host is running.`,
    );
    this.name = "FirefoxNotConnectedError";
  }
}

/** What tools need from the bridge; tests pass a FakeBridge instead of a socket client. */
export interface BridgeRequester {
  request<T = unknown>(
    method: BridgeMethod,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T>;
}

export class BridgeClient implements BridgeRequester {
  private socket: Socket | undefined;
  private readonly pending = new Map<string, PendingCall>();
  private counter = 0;

  constructor(private readonly socketPath: string = bridgeSocketPath()) {}

  /** Send one request to the extension and resolve with its result. */
  async request<T = unknown>(
    method: BridgeMethod,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const socket = await this.ensureSocket();
    const id = `r${++this.counter}`;
    const line = JSON.stringify({ id, method, params } satisfies BridgeRequest);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(id, new Error(`${method} timed out after ${timeoutMs / 1000}s`)),
        timeoutMs,
      );
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      socket.write(`${line}\n`);
    });
  }

  private ensureSocket(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    return new Promise((resolve, reject) => {
      const socket = connect(this.socketPath);
      const lines = new LineReader();
      socket.setEncoding("utf8");
      socket.once("connect", () => resolve(socket));
      // A persistent listener: an ECONNRESET after connect must fail pending calls, not crash
      // the process with an unhandled 'error' event (code review, 2026-10-24).
      socket.on("error", (error: NodeJS.ErrnoException) => {
        const failure = new FirefoxNotConnectedError(this.socketPath, error.code ?? error.message);
        reject(failure);
        this.failAll(failure);
      });
      socket.on("data", (chunk: string) => lines.feed(chunk).forEach((line) => this.receive(line)));
      socket.on("close", () =>
        this.failAll(new FirefoxNotConnectedError(this.socketPath, "connection closed")),
      );
      this.socket = socket;
    });
  }

  private receive(line: string): void {
    const response = JSON.parse(line) as BridgeResponse;
    const call = this.pending.get(String(response.id));
    if (!call) return;
    this.pending.delete(String(response.id));
    clearTimeout(call.timer);
    if (response.error !== undefined) call.reject(new Error(response.error));
    else call.resolve(response.result);
  }

  private fail(id: string, error: Error): void {
    const call = this.pending.get(id);
    if (!call) return;
    this.pending.delete(id);
    clearTimeout(call.timer);
    call.reject(error);
  }

  private failAll(error: Error): void {
    for (const id of [...this.pending.keys()]) this.fail(id, error);
    this.socket = undefined;
  }

  close(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }
}
