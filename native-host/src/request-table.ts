// Several MCP servers (one per Claude Code session) share one extension. The host rewrites
// each client's request id into a unique bridge id and maps the response back.

export interface PendingOrigin {
  clientId: number;
  clientRequestId: string;
}

export class PendingRequestTable {
  private readonly origins = new Map<string, PendingOrigin>();
  private counter = 0;

  register(clientId: number, clientRequestId: string): string {
    const bridgeId = `b${++this.counter}`;
    this.origins.set(bridgeId, { clientId, clientRequestId });
    return bridgeId;
  }

  /** Remove and return the origin of a bridge id, or undefined when unknown or already answered. */
  take(bridgeId: string): PendingOrigin | undefined {
    const origin = this.origins.get(bridgeId);
    this.origins.delete(bridgeId);
    return origin;
  }

  dropClient(clientId: number): void {
    for (const [bridgeId, origin] of this.origins) {
      if (origin.clientId === clientId) this.origins.delete(bridgeId);
    }
  }

  get size(): number {
    return this.origins.size;
  }
}
