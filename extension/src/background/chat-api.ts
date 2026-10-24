// Sidebar chat in the background: serves the sidebar's Port, forwards turns to the native
// host, applies the streamed events to the store and fans them out to every open sidebar.
import {
  isSidebarCommand,
  SIDEBAR_PORT_NAME,
  type ChatCommand,
  type ChatConversation,
  type ChatEvent,
  type ChatEventMessage,
  type SidebarCommand,
  type SidebarUpdate,
} from "../shared/chat-protocol";
import { applyChatEvent } from "../shared/chat-transcript";
import { composeChatPrompt, pickContextTab } from "./chat-prompt";
import {
  currentConversation,
  findConversation,
  listConversationSummaries,
  loadChatStore,
  newConversation,
  openConversation,
  persistChatStore,
} from "./chat-store";

type HostSender = (command: ChatCommand) => void;

const sidebarPorts = new Set<browser.runtime.Port>();
let sendToHost: HostSender = () => {
  throw new Error("chat api not started");
};
let hostConnected = false;

function broadcast(update: SidebarUpdate): void {
  for (const port of sidebarPorts) port.postMessage(update);
}

function snapshotOf(conversation: ChatConversation): SidebarUpdate {
  return {
    kind: "chatSnapshot",
    conversation,
    conversations: listConversationSummaries(),
    hostConnected,
  };
}

function applyAndBroadcast(conversation: ChatConversation, event: ChatEvent): void {
  applyChatEvent(conversation, event);
  broadcast({ kind: "chatDelta", conversationId: conversation.conversationId, event });
  if (event.type === "turn_end" || event.type === "exit" || event.type === "user")
    persistChatStore();
}

/** Host → store → sidebars. */
export function receiveChatEvent(message: ChatEventMessage): void {
  const conversation = findConversation(message.conversationId);
  if (conversation) applyAndBroadcast(conversation, message.event);
}

/** Mirror the native-host status into every sidebar. */
export function recordChatHostStatus(connected: boolean): void {
  hostConnected = connected;
  broadcast({ kind: "chatHostStatus", hostConnected });
}

function requireTurnText(text: unknown): string {
  if (typeof text !== "string" || !text.trim())
    throw new Error(`chat text must be a non-empty string, got ${JSON.stringify(text)}`);
  return text;
}

function idleConversation(conversationId: unknown, model: unknown): ChatConversation {
  const conversation = targetConversation(conversationId);
  if (conversation.busy) throw new Error("Claude is still answering: wait or press Stop");
  if (typeof model === "string" && model !== conversation.model)
    applyAndBroadcast(conversation, { type: "model", model });
  return conversation;
}

function targetConversation(conversationId: unknown): ChatConversation {
  if (typeof conversationId !== "string") return currentConversation();
  const conversation = findConversation(conversationId);
  if (!conversation)
    throw new Error(`unknown conversation "${conversationId}": expected an id from the chat list`);
  return conversation;
}

/**
 * Send one user turn (sidebar composer or the chat.send bridge method).
 * Example: await sendChatTurn("Summarise this page", "sonnet") → { conversationId: "c-…" }
 */
export async function sendChatTurn(
  text: unknown,
  model: unknown,
  conversationId?: unknown,
): Promise<{ conversationId: string }> {
  const turnText = requireTurnText(text);
  const conversation = idleConversation(conversationId, model);
  const firstTurn = conversation.items.length === 0;
  const prompt = composeChatPrompt(turnText, await pickContextTab(), firstTurn);
  applyAndBroadcast(conversation, { type: "user", text: turnText });
  sendToHost({
    kind: "chat",
    method: "chat.send",
    conversationId: conversation.conversationId,
    prompt,
    model: conversation.model || undefined,
    resumeSessionId: conversation.sessionId,
  });
  return { conversationId: conversation.conversationId };
}

/** chat.transcript bridge method: the current (or given) conversation. */
export function readChatTranscript(conversationId: unknown): ChatConversation {
  return targetConversation(conversationId);
}

function answerPermission(command: Extract<SidebarCommand, { kind: "sidebarPermission" }>): void {
  const { conversationId, requestId, allow } = command;
  sendToHost({ kind: "chat", method: "chat.permission", conversationId, requestId, allow });
  const conversation = findConversation(conversationId);
  if (conversation)
    applyAndBroadcast(conversation, { type: "permission_answered", requestId, allow });
}

async function handleSidebarCommand(
  port: browser.runtime.Port,
  command: SidebarCommand,
): Promise<void> {
  if (command.kind === "sidebarSend")
    return void (await sendChatTurn(command.text, command.model, command.conversationId));
  if (command.kind === "sidebarCancel")
    return sendToHost({
      kind: "chat",
      method: "chat.cancel",
      conversationId: command.conversationId,
    });
  if (command.kind === "sidebarPermission") return answerPermission(command);
  if (command.kind === "sidebarNewChat")
    return port.postMessage(snapshotOf(newConversation(currentConversation().model)));
  port.postMessage(snapshotOf(openConversation(command.conversationId)));
}

function reportFailure(port: browser.runtime.Port, command: SidebarCommand, error: unknown): void {
  const conversationId = "conversationId" in command ? command.conversationId : undefined;
  const conversation = conversationId ? findConversation(conversationId) : currentConversation();
  const message = error instanceof Error ? error.message : String(error);
  if (conversation) applyAndBroadcast(conversation, { type: "error", message });
  else port.postMessage(snapshotOf(currentConversation()));
}

function attachSidebar(port: browser.runtime.Port): void {
  sidebarPorts.add(port);
  port.onDisconnect.addListener(() => sidebarPorts.delete(port));
  port.onMessage.addListener((message: unknown) => {
    if (!isSidebarCommand(message)) return;
    handleSidebarCommand(port, message).catch((error: unknown) =>
      reportFailure(port, message, error),
    );
  });
  port.postMessage(snapshotOf(currentConversation()));
}

/** Start serving sidebars; `send` is the NativeHostLink's sendChatCommand. */
export function startChatApi(send: HostSender): void {
  sendToHost = send;
  void loadChatStore();
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === SIDEBAR_PORT_NAME) attachSidebar(port);
  });
}
