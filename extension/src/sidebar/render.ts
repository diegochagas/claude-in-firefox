// Pure DOM rendering of the sidebar from a SidebarSnapshot; tested under jsdom.
import type { ChatItem, SidebarSnapshot } from "../shared/chat-protocol";
import { renderMarkdown } from "./markdown";

export const EMPTY_HINT =
  "Ask anything about the page you are on. Claude can read it, click, type and open tabs through this browser, using your Claude Code login.";
export const NOT_CONNECTED_STATUS =
  "Native host not connected: open the toolbar popup and press Reconnect (run scripts/setup first on a new machine).";
const INPUT_SUMMARY_MAX_CHARS = 90;

function requireElement(root: ParentNode, id: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`#${id}`);
  if (!element) throw new Error(`sidebar is missing #${id}: expected the ids from sidebar.html`);
  return element;
}

/** Short, human description of a tool call's input for the collapsed tool line. */
export function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const fields = input as Record<string, unknown>;
  const favourite = ["action", "url", "query", "text", "command", "file_path", "ref"].find(
    (key) => typeof fields[key] === "string",
  );
  const summary = favourite ? `${favourite}=${String(fields[favourite])}` : JSON.stringify(input);
  return summary.length > INPUT_SUMMARY_MAX_CHARS
    ? `${summary.slice(0, INPUT_SUMMARY_MAX_CHARS)}…`
    : summary;
}

function imageElement(
  document: Document,
  image: { mediaType: string; base64: string },
): HTMLElement {
  const figure = document.createElement("img");
  figure.className = "shot";
  figure.alt = "screenshot returned by the tool";
  figure.src = `data:${image.mediaType};base64,${image.base64}`;
  return figure;
}

function toolElement(document: Document, item: Extract<ChatItem, { role: "tool" }>): HTMLElement {
  const details = toolDetails(document, item);
  if (!item.images?.length) return details;
  const wrapper = document.createElement("div");
  wrapper.className = "tool-with-images";
  wrapper.append(details, ...item.images.map((image) => imageElement(document, image)));
  return wrapper;
}

function toolDetails(document: Document, item: Extract<ChatItem, { role: "tool" }>): HTMLElement {
  const details = document.createElement("details");
  details.className = `tool${item.isError ? " error" : ""}`;
  const summary = document.createElement("summary");
  const name = item.name.replace(/^mcp__claude-in-firefox__/, "");
  const state = item.resultText === undefined ? "…" : "";
  summary.textContent = `⚙ ${name} ${summarizeToolInput(item.input)} ${state}`.trim();
  const result = document.createElement("pre");
  result.textContent = item.resultText ?? "(running)";
  details.append(summary, result);
  return details;
}

function permissionElement(
  document: Document,
  item: Extract<ChatItem, { role: "permission" }>,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "permission";
  const title = document.createElement("strong");
  title.textContent = `Claude wants to use ${item.toolName}`;
  const description = document.createElement("div");
  description.textContent = item.description;
  // The exact input is what the user approves (a Bash command, a file path): always shown.
  const input = document.createElement("pre");
  input.textContent = JSON.stringify(item.input, null, 1);
  card.append(title, description, input);
  card.append(
    item.decision
      ? decisionLabel(document, item.decision)
      : permissionButtons(document, item.requestId),
  );
  return card;
}

function decisionLabel(document: Document, decision: "allow" | "deny"): HTMLElement {
  const label = document.createElement("div");
  label.className = "actions";
  label.textContent = decision === "allow" ? "Allowed" : "Denied";
  return label;
}

function permissionButtons(document: Document, requestId: string): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "actions";
  for (const allow of [true, false]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = allow ? "Allow" : "Deny";
    button.dataset.requestId = requestId;
    button.dataset.allow = String(allow);
    actions.append(button);
  }
  return actions;
}

function itemElement(document: Document, item: ChatItem): HTMLElement {
  if (item.role === "tool") return toolElement(document, item);
  if (item.role === "permission") return permissionElement(document, item);
  const element = document.createElement("div");
  if (item.role === "status") {
    element.className = `status-line${item.isError ? " error" : ""}`;
    element.textContent = item.text;
    return element;
  }
  element.className = item.role === "user" ? "msg user" : "msg assistant";
  if (item.role === "user") element.textContent = item.text;
  else element.append(renderMarkdown(document, item.text));
  if (item.role === "assistant" && item.streaming) element.classList.add("streaming");
  return element;
}

function renderHeader(root: Document, snapshot: SidebarSnapshot): void {
  const picker = requireElement(root, "conversations") as HTMLSelectElement;
  picker.replaceChildren(
    ...snapshot.conversations.map((summary) => {
      const option = root.createElement("option");
      option.value = summary.conversationId;
      option.textContent = (summary.busy ? "● " : "") + summary.title;
      return option;
    }),
  );
  picker.value = snapshot.conversation.conversationId;
  (requireElement(root, "model") as HTMLSelectElement).value = snapshot.conversation.model;
}

function statusText(snapshot: SidebarSnapshot): string {
  if (!snapshot.hostConnected) return NOT_CONNECTED_STATUS;
  if (snapshot.conversation.busy) return "Claude is working…";
  return snapshot.conversation.sessionId ? "Ready" : "New chat";
}

function renderFooter(root: Document, snapshot: SidebarSnapshot): void {
  const status = requireElement(root, "status");
  status.textContent = statusText(snapshot);
  status.classList.toggle("error", !snapshot.hostConnected);
  const busy = snapshot.conversation.busy;
  (requireElement(root, "send") as HTMLButtonElement).disabled = busy || !snapshot.hostConnected;
  requireElement(root, "stop").hidden = !busy;
}

/** Fill the sidebar from a snapshot; the composer's text is left alone. */
export function renderSidebar(root: Document, snapshot: SidebarSnapshot): void {
  renderHeader(root, snapshot);
  const messages = requireElement(root, "messages");
  const items = snapshot.conversation.items.map((item) => itemElement(root, item));
  if (items.length === 0) {
    const hint = root.createElement("p");
    hint.className = "empty";
    hint.textContent = EMPTY_HINT;
    items.push(hint);
  }
  messages.replaceChildren(...items);
  renderFooter(root, snapshot);
}
