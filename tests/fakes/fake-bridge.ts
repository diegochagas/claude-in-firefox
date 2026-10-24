import type { BridgeMethod } from "../../extension/src/shared/protocol";
import type { BridgeRequester } from "../../mcp-server/src/bridge-client";

export interface RecordedRequest {
  method: BridgeMethod;
  params: Record<string, unknown>;
}

/** Records every request and answers from a scripted table of results per method. */
export class FakeBridge implements BridgeRequester {
  readonly requests: RecordedRequest[] = [];
  constructor(
    private readonly answers: Partial<
      Record<BridgeMethod, unknown | ((params: Record<string, unknown>) => unknown)>
    > = {},
  ) {}

  async request<T>(method: BridgeMethod, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ method, params });
    const answer = this.answers[method];
    if (answer instanceof Error) throw answer;
    return (
      typeof answer === "function"
        ? (answer as (p: Record<string, unknown>) => unknown)(params)
        : answer
    ) as T;
  }
}
