// One `claude -p` child per conversation: user turns go in as stream-json lines on stdin,
// stdout lines come back as ChatEvents, permission prompts are answered on stdin too.
import { spawn, type ChildProcess } from "node:child_process";
import type { ChatEvent } from "../../extension/src/shared/chat-protocol";
import { translateClaudeLine } from "./claude-stream";
import { LineReader } from "./line-reader";

/** After an interrupt request, a turn still running this long is killed (session stays resumable). */
export const CANCEL_GRACE_MS = 5_000;
const STDERR_TAIL_CHARS = 2_000;

export interface ClaudeProcessOptions {
  binary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  model: string;
}

export type ChatEventSink = (event: ChatEvent) => void;

export class ClaudeChatProcess {
  readonly model: string;
  sessionId: string | undefined;
  busy = false;
  lastUsedAt = Date.now();
  private readonly child: ChildProcess;
  private stderrTail = "";
  private exited = false;
  private requestCounter = 0;

  constructor(
    options: ClaudeProcessOptions,
    private readonly emit: ChatEventSink,
    spawnChild: typeof spawn = spawn,
  ) {
    this.model = options.model;
    this.child = spawnChild(options.binary, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.wireChild(options.binary);
  }

  get alive(): boolean {
    return !this.exited;
  }

  /** Queue one user turn. Example: process.send("Summarise this page") */
  send(prompt: string): void {
    this.busy = true;
    this.lastUsedAt = Date.now();
    this.writeLine({ type: "user", message: { role: "user", content: prompt } });
  }

  answerPermission(requestId: string, allow: boolean): void {
    const response = allow
      ? { behavior: "allow" }
      : { behavior: "deny", message: "The user denied this in the Firefox sidebar." };
    this.writeLine({
      type: "control_response",
      response: { subtype: "success", request_id: requestId, response },
    });
  }

  /** Ask claude to stop the current turn; kill it if it ignores the request. */
  cancel(): void {
    if (!this.busy) return;
    const requestId = `interrupt-${++this.requestCounter}`;
    this.writeLine({
      type: "control_request",
      request_id: requestId,
      request: { subtype: "interrupt" },
    });
    setTimeout(() => {
      if (this.busy && this.alive) this.child.kill("SIGTERM");
    }, CANCEL_GRACE_MS).unref();
  }

  /** Close stdin so claude exits after the current turn; force it after the grace period. */
  end(): void {
    this.child.stdin?.end();
    setTimeout(() => {
      if (this.alive) this.child.kill("SIGKILL");
    }, CANCEL_GRACE_MS).unref();
  }

  private writeLine(message: unknown): void {
    if (!this.alive) return this.emit({ type: "error", message: "claude is not running" });
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  private wireChild(binary: string): void {
    const lines = new LineReader();
    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) =>
      lines.feed(chunk).forEach((line) => this.receiveLine(line)),
    );
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
    });
    this.child.on("error", (error: NodeJS.ErrnoException) => this.failToStart(binary, error));
    this.child.on("exit", (code) => this.finish(code));
  }

  private receiveLine(line: string): void {
    for (const event of translateClaudeLine(line)) {
      if (event.type === "session") this.sessionId = event.sessionId;
      if (event.type === "turn_end") this.busy = false;
      this.emit(event);
    }
  }

  private failToStart(binary: string, error: NodeJS.ErrnoException): void {
    this.emit({
      type: "error",
      message: `cannot start claude at "${binary}" (${error.code ?? error.message}): install Claude Code, or set CLAUDE_IN_FIREFOX_CLAUDE_BIN to its path and reconnect`,
    });
    // A spawn failure (ENOENT) emits 'error' but never 'exit'.
    this.finish(null);
  }

  private finish(code: number | null): void {
    if (this.exited) return;
    this.exited = true;
    if (code !== 0 && this.stderrTail.trim())
      this.emit({ type: "error", message: this.stderrTail.trim() });
    this.emit({ type: "exit", code });
  }
}
