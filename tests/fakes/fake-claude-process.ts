import type { ChatProcessLike } from "../../native-host/src/chat-sessions";

/** Records what the session table does to a process; `alive`/`busy` are settable by the test. */
export class FakeClaudeProcess implements ChatProcessLike {
  readonly prompts: string[] = [];
  readonly permissions: Array<{ requestId: string; allow: boolean }> = [];
  cancelled = 0;
  ended = false;
  busy = false;
  alive = true;
  lastUsedAt = Date.now();

  constructor(
    readonly model: string,
    readonly resumeSessionId: string | undefined,
  ) {}

  send(prompt: string): void {
    this.prompts.push(prompt);
    this.busy = true;
  }
  answerPermission(requestId: string, allow: boolean): void {
    this.permissions.push({ requestId, allow });
  }
  cancel(): void {
    this.cancelled++;
  }
  end(): void {
    this.ended = true;
    this.alive = false;
  }
}
