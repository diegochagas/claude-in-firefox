// Sidebar chat wire types. Three hops share them: sidebar ⇄ background (a runtime Port named
// SIDEBAR_PORT_NAME), background ⇄ native host (the existing native-messaging port, chat
// messages tagged by `kind` so they never collide with BridgeRequest/BridgeResponse), and the
// host's translation of `claude -p --output-format stream-json` lines into ChatEvents.

/** Background → host: drive the `claude` process that backs one conversation. */
export type ChatCommand =
  | {
      kind: "chat";
      method: "chat.send";
      conversationId: string;
      /** Full prompt for Claude (the user's text plus the Firefox tab context). */
      prompt: string;
      /** Model alias ("sonnet", "opus", …); omitted = the user's Claude Code default. */
      model?: string;
      /** Claude Code session id to `--resume` when no process is alive for the conversation. */
      resumeSessionId?: string;
    }
  | { kind: "chat"; method: "chat.cancel"; conversationId: string }
  | {
      kind: "chat";
      method: "chat.permission";
      conversationId: string;
      requestId: string;
      allow: boolean;
    }
  | { kind: "chat"; method: "chat.end"; conversationId: string };

export function isChatCommand(message: unknown): message is ChatCommand {
  return (message as ChatCommand | null)?.kind === "chat";
}

/** Host → background: one event of a conversation's stream. */
export interface ChatEventMessage {
  kind: "chatEvent";
  conversationId: string;
  event: ChatEvent;
}

export function isChatEventMessage(message: unknown): message is ChatEventMessage {
  return (message as ChatEventMessage | null)?.kind === "chatEvent";
}

/**
 * Everything that changes a transcript. `user`, `model` and `permission_answered` are produced
 * locally by the background; the rest is translated from Claude Code's stream-json output.
 */
export type ChatEvent =
  | { type: "user"; text: string }
  | { type: "model"; model: string }
  | { type: "session"; sessionId: string; model: string }
  | { type: "text"; delta: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_use"; toolUseId: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; text: string; isError: boolean; images?: ChatImage[] }
  | {
      type: "permission";
      requestId: string;
      toolName: string;
      input: unknown;
      description: string;
    }
  | { type: "permission_answered"; requestId: string; allow: boolean }
  | {
      type: "turn_end";
      isError: boolean;
      resultText: string;
      durationMs: number;
      costUsd: number;
    }
  | { type: "error"; message: string }
  | { type: "exit"; code: number | null };

/** A screenshot (or other image) a tool returned; shown inline in the sidebar, never persisted. */
export interface ChatImage {
  mediaType: string;
  base64: string;
}

/** One rendered row of the transcript. */
export type ChatItem =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; streaming: boolean }
  | {
      role: "tool";
      toolUseId: string;
      name: string;
      input: unknown;
      resultText?: string;
      isError?: boolean;
      images?: ChatImage[];
    }
  | {
      role: "permission";
      requestId: string;
      toolName: string;
      input: unknown;
      description: string;
      decision?: "allow" | "deny";
    }
  | { role: "status"; text: string; isError: boolean };

export interface ChatConversation {
  conversationId: string;
  /** Claude Code session id, known after the first turn; lets the host `--resume` later. */
  sessionId?: string;
  /** Model alias; "" means the Claude Code default. */
  model: string;
  title: string;
  busy: boolean;
  updatedAt: number;
  items: ChatItem[];
}

export interface ChatConversationSummary {
  conversationId: string;
  title: string;
  updatedAt: number;
  busy: boolean;
}

export const SIDEBAR_PORT_NAME = "claude-chat-sidebar";

/** Sidebar → background. */
export type SidebarCommand =
  | { kind: "sidebarSend"; conversationId: string; text: string; model: string }
  | { kind: "sidebarCancel"; conversationId: string }
  | { kind: "sidebarPermission"; conversationId: string; requestId: string; allow: boolean }
  | { kind: "sidebarNewChat" }
  | { kind: "sidebarOpenChat"; conversationId: string };

export function isSidebarCommand(message: unknown): message is SidebarCommand {
  const kind = (message as SidebarCommand | null)?.kind;
  return typeof kind === "string" && kind.startsWith("sidebar");
}

/** What the sidebar keeps and renders. */
export interface SidebarSnapshot {
  conversation: ChatConversation;
  conversations: ChatConversationSummary[];
  hostConnected: boolean;
}

/** Background → sidebar. */
export type SidebarUpdate =
  | ({ kind: "chatSnapshot" } & SidebarSnapshot)
  | { kind: "chatDelta"; conversationId: string; event: ChatEvent }
  | { kind: "chatHostStatus"; hostConnected: boolean };
