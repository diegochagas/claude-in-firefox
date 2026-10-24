// Live `claude` processes by conversation. A conversation whose process is gone (host restart,
// eviction, model switch) is resumed through its Claude Code session id on the next turn.
import type { ChatCommand, ChatEvent } from "../../extension/src/shared/chat-protocol";

/** The public surface of ClaudeChatProcess; tests pass a FakeClaudeProcess. */
export interface ChatProcessLike {
  readonly model: string;
  readonly busy: boolean;
  readonly alive: boolean;
  readonly lastUsedAt: number;
  send(prompt: string): void;
  answerPermission(requestId: string, allow: boolean): void;
  cancel(): void;
  end(): void;
}

export interface ChatProcessSpawn {
  (
    model: string,
    resumeSessionId: string | undefined,
    emit: (event: ChatEvent) => void,
  ): ChatProcessLike;
}

export const MAX_LIVE_CLAUDE_PROCESSES = 3;

interface LiveProcess {
  process: ChatProcessLike;
  /** Set when the table lets go of the process; its late events must not reach the conversation. */
  dropped: boolean;
}

export class ChatSessionTable {
  private readonly live = new Map<string, LiveProcess>();
  private readonly knownSessionIds = new Map<string, string>();

  constructor(
    private readonly spawnProcess: ChatProcessSpawn,
    private readonly emit: (conversationId: string, event: ChatEvent) => void,
    private readonly maxLive = MAX_LIVE_CLAUDE_PROCESSES,
  ) {}

  /** Route one command from the extension. */
  handle(command: ChatCommand): void {
    if (command.method === "chat.send") return this.send(command);
    const process = this.live.get(command.conversationId)?.process;
    if (command.method === "chat.cancel") return process?.cancel();
    if (command.method === "chat.permission")
      return process?.answerPermission(command.requestId, command.allow);
    this.drop(command.conversationId);
  }

  get liveCount(): number {
    return this.live.size;
  }

  /** Kill every process (host shutting down). */
  shutdown(): void {
    for (const id of [...this.live.keys()]) this.drop(id);
  }

  private send(command: Extract<ChatCommand, { method: "chat.send" }>): void {
    const { conversationId } = command;
    const wanted = command.model ?? "";
    const current = this.live.get(conversationId)?.process;
    if (current && (!current.alive || current.model !== wanted)) this.drop(conversationId);
    const process =
      this.live.get(conversationId)?.process ?? this.start(conversationId, wanted, command);
    process.send(command.prompt);
  }

  private start(
    conversationId: string,
    model: string,
    command: Extract<ChatCommand, { method: "chat.send" }>,
  ): ChatProcessLike {
    this.evictIdleIfFull();
    const resume = command.resumeSessionId ?? this.knownSessionIds.get(conversationId);
    const slot: LiveProcess = { process: undefined as unknown as ChatProcessLike, dropped: false };
    slot.process = this.spawnProcess(model, resume, (event) =>
      this.forward(conversationId, slot, event),
    );
    this.live.set(conversationId, slot);
    return slot.process;
  }

  private forward(conversationId: string, slot: LiveProcess, event: ChatEvent): void {
    // A process dropped for a model switch or eviction may still exit later; the conversation
    // is already served by its successor (code review, 2026-10-24).
    if (slot.dropped) return;
    if (event.type === "session") this.knownSessionIds.set(conversationId, event.sessionId);
    if (event.type === "exit") this.live.delete(conversationId);
    this.emit(conversationId, event);
  }

  private evictIdleIfFull(): void {
    if (this.live.size < this.maxLive) return;
    const idle = [...this.live.entries()]
      .filter(([, slot]) => !slot.process.busy)
      .sort(([, a], [, b]) => a.process.lastUsedAt - b.process.lastUsedAt)[0];
    if (idle) this.drop(idle[0]);
  }

  private drop(conversationId: string): void {
    const slot = this.live.get(conversationId);
    this.live.delete(conversationId);
    if (!slot) return;
    slot.dropped = true;
    slot.process.end();
  }
}
