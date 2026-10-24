// Sidebar entry: a Port to the background, a local copy of the shown conversation kept in
// step with the background's through the shared reducer, and the composer's controls.
import {
  SIDEBAR_PORT_NAME,
  type SidebarCommand,
  type SidebarSnapshot,
  type SidebarUpdate,
} from "../shared/chat-protocol";
import { applyChatEvent } from "../shared/chat-transcript";
import { renderSidebar } from "./render";

const RECONNECT_DELAY_MS = 1_000;
let snapshot: SidebarSnapshot | undefined;
let port: browser.runtime.Port | undefined;

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function post(command: SidebarCommand): void {
  port?.postMessage(command);
}

function redraw(): void {
  if (!snapshot) return;
  const messages = element<HTMLElement>("messages");
  const stickToBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
  renderSidebar(document, snapshot);
  if (stickToBottom) messages.scrollTop = messages.scrollHeight;
}

function receive(update: SidebarUpdate): void {
  if (update.kind === "chatSnapshot") snapshot = update;
  else if (update.kind === "chatHostStatus" && snapshot)
    snapshot.hostConnected = update.hostConnected;
  else if (
    update.kind === "chatDelta" &&
    snapshot?.conversation.conversationId === update.conversationId
  )
    applyChatEvent(snapshot.conversation, update.event);
  redraw();
}

function connect(): void {
  port = browser.runtime.connect({ name: SIDEBAR_PORT_NAME });
  port.onMessage.addListener((message: unknown) => receive(message as SidebarUpdate));
  port.onDisconnect.addListener(() => {
    port = undefined;
    element<HTMLElement>("status").textContent = "Reconnecting to the extension…";
    setTimeout(connect, RECONNECT_DELAY_MS);
  });
}

function sendComposer(): void {
  const composer = element<HTMLTextAreaElement>("composer");
  const text = composer.value.trim();
  if (!text || !snapshot || snapshot.conversation.busy) return;
  const model = element<HTMLSelectElement>("model").value;
  post({ kind: "sidebarSend", conversationId: snapshot.conversation.conversationId, text, model });
  composer.value = "";
}

function wireComposer(): void {
  element<HTMLButtonElement>("send").addEventListener("click", sendComposer);
  element<HTMLTextAreaElement>("composer").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    sendComposer();
  });
  element<HTMLButtonElement>("stop").addEventListener("click", () => {
    if (snapshot)
      post({ kind: "sidebarCancel", conversationId: snapshot.conversation.conversationId });
  });
}

function wireHeader(): void {
  element<HTMLButtonElement>("new-chat").addEventListener("click", () =>
    post({ kind: "sidebarNewChat" }),
  );
  element<HTMLSelectElement>("conversations").addEventListener("change", (event) =>
    post({ kind: "sidebarOpenChat", conversationId: (event.target as HTMLSelectElement).value }),
  );
  element<HTMLSelectElement>("model").addEventListener("change", (event) => {
    if (snapshot) snapshot.conversation.model = (event.target as HTMLSelectElement).value;
  });
}

function wirePermissionButtons(): void {
  element<HTMLElement>("messages").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-request-id]",
    );
    if (!button || !snapshot) return;
    post({
      kind: "sidebarPermission",
      conversationId: snapshot.conversation.conversationId,
      requestId: button.dataset.requestId!,
      allow: button.dataset.allow === "true",
    });
  });
}

wireComposer();
wireHeader();
wirePermissionButtons();
connect();
