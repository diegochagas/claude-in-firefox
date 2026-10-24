// Conversations the sidebar can show. Kept in memory (the background page is persistent) and
// mirrored to storage.local without live processes, so a browser restart keeps the history
// and the session ids needed to resume.
import type { ChatConversation, ChatConversationSummary } from "../shared/chat-protocol";
import { createConversation, settleConversation } from "../shared/chat-transcript";

const STORAGE_KEY = "chatConversations";
const CURRENT_KEY = "chatCurrentId";
const KEEP_CONVERSATIONS = 20;
const KEEP_ITEMS_PER_CONVERSATION = 400;

const conversations = new Map<string, ChatConversation>();
let currentId: string | undefined;

function newConversationId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The conversation the sidebar shows; created on first use. */
export function currentConversation(): ChatConversation {
  const current = currentId ? conversations.get(currentId) : undefined;
  return current ?? newConversation(lastModel());
}

function lastModel(): string {
  return [...conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.model ?? "";
}

export function newConversation(model: string): ChatConversation {
  const conversation = createConversation(newConversationId(), model);
  conversations.set(conversation.conversationId, conversation);
  currentId = conversation.conversationId;
  return conversation;
}

export function findConversation(conversationId: string): ChatConversation | undefined {
  return conversations.get(conversationId);
}

/** Switch the sidebar to an existing conversation. */
export function openConversation(conversationId: string): ChatConversation {
  const conversation = conversations.get(conversationId);
  if (!conversation)
    throw new Error(`unknown conversation "${conversationId}": expected an id from the chat list`);
  currentId = conversationId;
  return conversation;
}

export function listConversationSummaries(): ChatConversationSummary[] {
  return [...conversations.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ conversationId, title, updatedAt, busy }) => ({
      conversationId,
      title,
      updatedAt,
      busy,
    }));
}

function trimmed(conversation: ChatConversation): ChatConversation {
  return { ...conversation, items: conversation.items.slice(-KEEP_ITEMS_PER_CONVERSATION) };
}

/** Write the newest conversations to storage.local. */
export function persistChatStore(): void {
  const kept = [...conversations.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, KEEP_CONVERSATIONS)
    .map(trimmed);
  void browser.storage.local.set({ [STORAGE_KEY]: kept, [CURRENT_KEY]: currentId ?? "" });
}

/** Load saved conversations; their processes are gone, so none is busy. */
export async function loadChatStore(): Promise<void> {
  const stored = await browser.storage.local.get([STORAGE_KEY, CURRENT_KEY]);
  const saved = (stored[STORAGE_KEY] as ChatConversation[] | undefined) ?? [];
  for (const conversation of saved) {
    settleConversation(conversation);
    conversations.set(conversation.conversationId, conversation);
  }
  const savedCurrent = stored[CURRENT_KEY] as string | undefined;
  if (savedCurrent && conversations.has(savedCurrent)) currentId = savedCurrent;
}
