import { describe, expect, it } from "vitest";
import {
  applyChatEvent,
  createConversation,
  settleConversation,
  summarizeConversation,
} from "../extension/src/shared/chat-transcript";
import { composeChatPrompt } from "../extension/src/background/chat-prompt";

describe("applyChatEvent", () => {
  it("builds a transcript from a streamed turn and titles the chat from the first message", () => {
    const conversation = createConversation("c1");
    applyChatEvent(conversation, { type: "user", text: "  What is   this page? " });
    expect(conversation.title).toBe("What is this page?");
    expect(conversation.busy).toBe(true);
    applyChatEvent(conversation, { type: "session", sessionId: "s1", model: "m" });
    applyChatEvent(conversation, { type: "text", delta: "It " });
    applyChatEvent(conversation, { type: "text", delta: "is" });
    expect(conversation.items[1]).toEqual({ role: "assistant", text: "It is", streaming: true });
    applyChatEvent(conversation, { type: "assistant_text", text: "It is a fixture." });
    expect(conversation.items[1]).toEqual({
      role: "assistant",
      text: "It is a fixture.",
      streaming: false,
    });
    applyChatEvent(conversation, {
      type: "tool_use",
      toolUseId: "t1",
      name: "find",
      input: { query: "x" },
    });
    applyChatEvent(conversation, {
      type: "tool_result",
      toolUseId: "t1",
      text: "ref_1",
      isError: false,
    });
    expect(conversation.items[2]).toMatchObject({
      role: "tool",
      name: "find",
      resultText: "ref_1",
    });
    applyChatEvent(conversation, {
      type: "turn_end",
      isError: false,
      resultText: "",
      durationMs: 1,
      costUsd: 0,
    });
    expect(conversation.busy).toBe(false);
    expect(conversation.sessionId).toBe("s1");
    expect(conversation.items).toHaveLength(3);
  });
  it("closes a streaming bubble when a tool call or permission interrupts it", () => {
    const conversation = createConversation("c1");
    applyChatEvent(conversation, { type: "text", delta: "Let me look" });
    applyChatEvent(conversation, {
      type: "permission",
      requestId: "p1",
      toolName: "Bash",
      input: {},
      description: "ls",
    });
    expect(conversation.items[0]).toMatchObject({ role: "assistant", streaming: false });
    applyChatEvent(conversation, { type: "permission_answered", requestId: "p1", allow: true });
    expect(conversation.items[1]).toMatchObject({ role: "permission", decision: "allow" });
    applyChatEvent(conversation, { type: "text", delta: "Now" });
    expect(conversation.items[2]).toEqual({ role: "assistant", text: "Now", streaming: true });
  });
  it("records errors, failed turns and unexpected exits as status lines", () => {
    const conversation = createConversation("c1");
    applyChatEvent(conversation, { type: "user", text: "hi" });
    applyChatEvent(conversation, { type: "error", message: "boom" });
    applyChatEvent(conversation, {
      type: "turn_end",
      isError: true,
      resultText: "error_max_turns",
      durationMs: 0,
      costUsd: 0,
    });
    expect(conversation.items.slice(1)).toEqual([
      { role: "status", text: "boom", isError: true },
      { role: "status", text: "error_max_turns", isError: true },
    ]);
    applyChatEvent(conversation, { type: "user", text: "again" });
    applyChatEvent(conversation, { type: "exit", code: 1 });
    expect(conversation.busy).toBe(false);
    expect(conversation.items.at(-1)).toEqual({
      role: "status",
      text: "claude exited (code 1)",
      isError: true,
    });
    applyChatEvent(conversation, { type: "exit", code: 0 });
    expect(conversation.items).toHaveLength(5);
  });
  it("summarizes a conversation for the picker (title follows the first message)", () => {
    const conversation = createConversation("c1");
    expect(summarizeConversation(conversation).title).toBe("New chat");
    applyChatEvent(conversation, { type: "user", text: "And this one?" });
    expect(summarizeConversation(conversation)).toEqual({
      conversationId: "c1",
      title: "And this one?",
      updatedAt: conversation.updatedAt,
      busy: true,
    });
  });
  it("records a model change", () => {
    const conversation = createConversation("c1");
    applyChatEvent(conversation, { type: "model", model: "opus" });
    expect(conversation.model).toBe("opus");
  });
  it("settleConversation makes a restored conversation idle", () => {
    const conversation = createConversation("c1");
    applyChatEvent(conversation, { type: "user", text: "hi" });
    applyChatEvent(conversation, { type: "text", delta: "partial" });
    settleConversation(conversation);
    expect(conversation.busy).toBe(false);
    expect(conversation.items[1]).toMatchObject({ streaming: false });
  });
});

describe("composeChatPrompt", () => {
  const tab = { tabId: 4, title: "Docs", url: "https://d.test/?token=abc" };
  it("prefixes the tab context, with tool guidance on the first turn only, and redacts the url", () => {
    const first = composeChatPrompt("What is this?", tab, true);
    expect(first).toMatch(
      /^<firefox_context>The user is looking at tabId=4 "Docs" https:\/\/d\.test\/\?token=REDACTED\. Use tabId=4/,
    );
    expect(first.endsWith("</firefox_context>\n\nWhat is this?")).toBe(true);
    expect(composeChatPrompt("More", tab, false)).not.toContain("Use tabId");
    expect(composeChatPrompt("No tab", undefined, true)).toBe("No tab");
  });
});
