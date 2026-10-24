// Pure transcript reducer: the background applies every ChatEvent to its copy of a conversation
// and forwards the event; the sidebar applies the same reducer to its copy, so both agree.
import type {
  ChatConversation,
  ChatConversationSummary,
  ChatEvent,
  ChatItem,
} from "./chat-protocol";

const TITLE_MAX_CHARS = 60;

/** A fresh, idle conversation. Example: createConversation("c-1", "sonnet") */
export function createConversation(conversationId: string, model = ""): ChatConversation {
  return {
    conversationId,
    model,
    title: "New chat",
    busy: false,
    updatedAt: Date.now(),
    items: [],
  };
}

function lastItem(conversation: ChatConversation): ChatItem | undefined {
  return conversation.items[conversation.items.length - 1];
}

function finishStreamingText(conversation: ChatConversation): void {
  const last = lastItem(conversation);
  if (last?.role === "assistant") last.streaming = false;
}

function addUser(conversation: ChatConversation, text: string): void {
  if (conversation.items.length === 0)
    conversation.title = text.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_CHARS) || "New chat";
  conversation.items.push({ role: "user", text });
  conversation.busy = true;
}

function appendText(conversation: ChatConversation, delta: string): void {
  const last = lastItem(conversation);
  if (last?.role === "assistant" && last.streaming) {
    last.text += delta;
    return;
  }
  conversation.items.push({ role: "assistant", text: delta, streaming: true });
}

function setAssistantText(conversation: ChatConversation, text: string): void {
  const last = lastItem(conversation);
  if (last?.role === "assistant" && last.streaming) {
    last.text = text;
    last.streaming = false;
    return;
  }
  conversation.items.push({ role: "assistant", text, streaming: false });
}

function recordToolResult(
  conversation: ChatConversation,
  event: Extract<ChatEvent, { type: "tool_result" }>,
): void {
  const tool = conversation.items.find(
    (item) => item.role === "tool" && item.toolUseId === event.toolUseId,
  );
  if (!tool || tool.role !== "tool") return;
  tool.resultText = event.text;
  tool.isError = event.isError;
  if (event.images?.length) tool.images = event.images;
}

function answerPermission(conversation: ChatConversation, requestId: string, allow: boolean): void {
  for (const item of conversation.items) {
    if (item.role === "permission" && item.requestId === requestId)
      item.decision = allow ? "allow" : "deny";
  }
}

function endTurn(
  conversation: ChatConversation,
  event: Extract<ChatEvent, { type: "turn_end" }>,
): void {
  finishStreamingText(conversation);
  conversation.busy = false;
  if (event.isError)
    conversation.items.push({ role: "status", text: event.resultText, isError: true });
}

function recordExit(conversation: ChatConversation, code: number | null): void {
  finishStreamingText(conversation);
  if (conversation.busy)
    conversation.items.push({
      role: "status",
      text: `claude exited (code ${code})`,
      isError: true,
    });
  conversation.busy = false;
}

/** Apply one event in place. Example: applyChatEvent(conversation, { type: "text", delta: "Hi" }) */
export function applyChatEvent(conversation: ChatConversation, event: ChatEvent): void {
  conversation.updatedAt = Date.now();
  if (event.type === "user") return addUser(conversation, event.text);
  if (event.type === "text") return appendText(conversation, event.delta);
  if (event.type === "assistant_text") return setAssistantText(conversation, event.text);
  if (event.type === "turn_end") return endTurn(conversation, event);
  if (event.type === "exit") return recordExit(conversation, event.code);
  applyRemainingEvent(conversation, event);
}

function addToolUse(
  conversation: ChatConversation,
  event: Extract<ChatEvent, { type: "tool_use" }>,
): void {
  finishStreamingText(conversation);
  const { toolUseId, name, input } = event;
  conversation.items.push({ role: "tool", toolUseId, name, input });
}

function addPermission(
  conversation: ChatConversation,
  event: Extract<ChatEvent, { type: "permission" }>,
): void {
  finishStreamingText(conversation);
  const { requestId, toolName, input, description } = event;
  conversation.items.push({ role: "permission", requestId, toolName, input, description });
}

function applyRemainingEvent(conversation: ChatConversation, event: ChatEvent): void {
  if (event.type === "session") conversation.sessionId = event.sessionId;
  else if (event.type === "model") conversation.model = event.model;
  else if (event.type === "tool_use") addToolUse(conversation, event);
  else if (event.type === "tool_result") recordToolResult(conversation, event);
  else if (event.type === "permission") addPermission(conversation, event);
  else if (event.type === "permission_answered")
    answerPermission(conversation, event.requestId, event.allow);
  else if (event.type === "error")
    conversation.items.push({ role: "status", text: event.message, isError: true });
}

/** The picker row for a conversation. Example: summarizeConversation(conversation).title */
export function summarizeConversation(conversation: ChatConversation): ChatConversationSummary {
  const { conversationId, title, updatedAt, busy } = conversation;
  return { conversationId, title, updatedAt, busy };
}

/** Copy without tool images (hundreds of KB each): what goes to storage.local. */
export function withoutImages(conversation: ChatConversation): ChatConversation {
  return {
    ...conversation,
    items: conversation.items.map((item) =>
      item.role === "tool" && item.images ? { ...item, images: undefined } : item,
    ),
  };
}

/** Mark a conversation idle after a restart: its process is gone, nothing is streaming. */
export function settleConversation(conversation: ChatConversation): void {
  finishStreamingText(conversation);
  conversation.busy = false;
}
