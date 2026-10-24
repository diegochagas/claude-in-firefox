import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../extension/src/shared/chat-protocol";
import { ChatSessionTable } from "../native-host/src/chat-sessions";
import { ClaudeChatProcess } from "../native-host/src/claude-process";
import { FakeClaudeProcess } from "./fakes/fake-claude-process";

const FAKE_CLAUDE = resolve("tests/fakes/fake-claude.mjs");

function startFake(extraArgs: string[] = []): {
  process: ClaudeChatProcess;
  events: ChatEvent[];
  until: (type: ChatEvent["type"]) => Promise<ChatEvent>;
} {
  const events: ChatEvent[] = [];
  const waiters: Array<{ type: string; resolve: (event: ChatEvent) => void }> = [];
  const process_ = new ClaudeChatProcess(
    {
      binary: process.execPath,
      args: [FAKE_CLAUDE, ...extraArgs],
      cwd: mkdtempSync(join(tmpdir(), "fake-claude-")),
      env: process.env,
      model: "",
    },
    (event) => {
      events.push(event);
      waiters.filter((w) => w.type === event.type).forEach((w) => w.resolve(event));
    },
  );
  const until = (type: ChatEvent["type"]) =>
    new Promise<ChatEvent>((resolveEvent) => {
      const seen = events.find((e) => e.type === type);
      if (seen) return resolveEvent(seen);
      waiters.push({ type, resolve: resolveEvent });
    });
  return { process: process_, events, until };
}

describe("ClaudeChatProcess with the fake claude", () => {
  it("streams a turn: session, tool call + result, text deltas, final text, turn end", async () => {
    const { process: claude, events, until } = startFake(["--model=haiku"]);
    claude.send("hello");
    expect(claude.busy).toBe(true);
    await until("turn_end");
    expect(claude.busy).toBe(false);
    expect(claude.sessionId).toMatch(/^fake-session-/);
    expect(events.map((e) => e.type)).toEqual([
      "session",
      "tool_use",
      "tool_result",
      "text",
      "text",
      "assistant_text",
      "turn_end",
    ]);
    expect(events.find((e) => e.type === "assistant_text")).toMatchObject({
      text: "Fake reply to: hello",
    });
    claude.end();
    await until("exit");
    expect(claude.alive).toBe(false);
  });

  it("relays permission prompts and the user's answer", async () => {
    const { process: claude, events, until } = startFake();
    claude.send("needs-permission please");
    const permission = (await until("permission")) as Extract<ChatEvent, { type: "permission" }>;
    expect(permission).toMatchObject({
      requestId: "perm-1",
      toolName: "Bash",
      input: { command: "touch probe.txt" },
    });
    claude.answerPermission(permission.requestId, false);
    await until("turn_end");
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({
      isError: true,
      text: "denied by user",
    });
    expect(events.find((e) => e.type === "assistant_text")).toMatchObject({
      text: /Permission denied/,
    });
    claude.end();
    await until("exit");
  });

  it("cancel interrupts a slow turn", async () => {
    const { process: claude, until } = startFake();
    claude.send("slow-please");
    await until("session");
    claude.cancel();
    const end = await until("turn_end");
    expect(end).toMatchObject({ isError: true, resultText: "Interrupted by user" });
    claude.end();
    await until("exit");
  });

  it("reports a missing binary instead of crashing", async () => {
    const events: ChatEvent[] = [];
    const exited = new Promise<void>((done) => {
      new ClaudeChatProcess(
        { binary: "/nonexistent/claude", args: [], cwd: tmpdir(), env: process.env, model: "" },
        (event) => {
          events.push(event);
          if (event.type === "exit") done();
        },
      );
    });
    await exited;
    expect(events[0]).toMatchObject({
      type: "error",
      message: /cannot start claude at "\/nonexistent\/claude" \(ENOENT\)/,
    });
  });
});

describe("ChatSessionTable", () => {
  function table(maxLive = 3) {
    const spawned: FakeClaudeProcess[] = [];
    const emitted: Array<{ conversationId: string; event: ChatEvent }> = [];
    const sessions = new ChatSessionTable(
      (model, resume, emit) => {
        const fake = new FakeClaudeProcess(model, resume);
        spawned.push(fake);
        setTimeout(() => emit({ type: "session", sessionId: `sess-${spawned.length}`, model }), 0);
        return fake;
      },
      (conversationId, event) => emitted.push({ conversationId, event }),
      maxLive,
    );
    return { sessions, spawned, emitted };
  }
  const send = (conversationId: string, prompt: string, model?: string, resumeSessionId?: string) =>
    ({
      kind: "chat",
      method: "chat.send",
      conversationId,
      prompt,
      model,
      resumeSessionId,
    }) as const;

  it("reuses the live process of a conversation and routes cancel/permission to it", () => {
    const { sessions, spawned } = table();
    sessions.handle(send("c1", "one"));
    sessions.handle(send("c1", "two"));
    sessions.handle({ kind: "chat", method: "chat.cancel", conversationId: "c1" });
    sessions.handle({
      kind: "chat",
      method: "chat.permission",
      conversationId: "c1",
      requestId: "r",
      allow: true,
    });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.prompts).toEqual(["one", "two"]);
    expect(spawned[0]!.cancelled).toBe(1);
    expect(spawned[0]!.permissions).toEqual([{ requestId: "r", allow: true }]);
  });

  it("respawns with --resume when the model changes or the process died, remembering the session id", async () => {
    const { sessions, spawned } = table();
    sessions.handle(send("c1", "one", "sonnet"));
    await new Promise((wake) => setTimeout(wake, 5));
    sessions.handle(send("c1", "two", "opus"));
    expect(spawned).toHaveLength(2);
    expect(spawned[0]!.ended).toBe(true);
    expect(spawned[1]).toMatchObject({ model: "opus", resumeSessionId: "sess-1" });
    spawned[1]!.alive = false;
    sessions.handle(send("c1", "three", "opus", "explicit-session"));
    expect(spawned[2]).toMatchObject({ resumeSessionId: "explicit-session" });
  });

  it("evicts the oldest idle process when full and ends everything on shutdown", () => {
    const { sessions, spawned } = table(2);
    sessions.handle(send("c1", "a"));
    sessions.handle(send("c2", "b"));
    spawned[0]!.busy = false;
    spawned[0]!.lastUsedAt = 1;
    sessions.handle(send("c3", "c"));
    expect(spawned[0]!.ended).toBe(true);
    expect(sessions.liveCount).toBe(2);
    sessions.handle({ kind: "chat", method: "chat.end", conversationId: "c2" });
    expect(spawned[1]!.ended).toBe(true);
    sessions.shutdown();
    expect(spawned.every((p) => p.ended)).toBe(true);
    expect(sessions.liveCount).toBe(0);
  });
});
