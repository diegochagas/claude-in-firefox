// End-to-end for the sidebar chat: the sidebar page opens in a tab of the headless Firefox, a
// turn goes in through the bridge (`chat.send`), the native host runs tests/fakes/fake-claude.mjs
// in place of `claude`, and the streamed reply shows up in the transcript (`chat.transcript`)
// and in a screenshot of the sidebar.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatConversation } from "../extension/src/shared/chat-protocol";
import { BridgeClient } from "../mcp-server/src/bridge-client";
import { createFirefoxMcpServer } from "../mcp-server/src/main";
import { startFirefoxHarness, type FirefoxHarness } from "./firefox-harness";

let harness: FirefoxHarness;
let client: Client;
let bridge: BridgeClient;
let sidebarTabId: number;
let fixtureTabId: number;

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const texts = (result.content as TextContent[])
    .filter((c) => c.type === "text")
    .map((c) => c.text);
  if (result.isError) throw new Error(`${name} failed: ${texts.join("\n")}`);
  return texts.join("\n");
}

async function transcript(conversationId: string): Promise<ChatConversation> {
  return bridge.request<ChatConversation>("chat.transcript", { conversationId });
}

async function waitForTurnEnd(conversationId: string): Promise<ChatConversation> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const conversation = await transcript(conversationId);
    if (!conversation.busy) return conversation;
    await new Promise((wake) => setTimeout(wake, 200));
  }
  throw new Error(`conversation ${conversationId} still busy after 20s`);
}

async function waitForItem(conversationId: string, role: string): Promise<ChatConversation> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const conversation = await transcript(conversationId);
    if (conversation.items.some((item) => item.role === role)) return conversation;
    await new Promise((wake) => setTimeout(wake, 200));
  }
  throw new Error(`conversation ${conversationId} has no ${role} item after 20s`);
}

async function screenshotTab(tabId: number, file: string): Promise<void> {
  const result = await client.callTool({
    name: "computer",
    arguments: { action: "screenshot", tabId },
  });
  expect(result.isError).toBeFalsy();
  const [image] = result.content as [ImageContent];
  mkdirSync("e2e/screenshots", { recursive: true });
  writeFileSync(`e2e/screenshots/${file}`, Buffer.from(image.data, "base64"));
}

beforeAll(async () => {
  harness = await startFirefoxHarness();
  bridge = new BridgeClient(harness.socketPath);
  const { server } = createFirefoxMcpServer(bridge);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "e2e-sidebar", version: "0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  bridge?.close();
  await harness?.stop();
});

describe("sidebar chat through the fake claude", () => {
  it("opens the fixture page, then the sidebar page as the active tab", async () => {
    // The sidebar page goes last (and stays active) so headless Firefox paints it for the
    // screenshot; the chat must then fall back to the most recently used web page for context.
    const fixture = await call("tabs_create", { url: `${harness.baseUrl}/index.html` });
    fixtureTabId = Number(/tabId=(\d+)/.exec(fixture)![1]);
    const sidebar = await call("tabs_create", { url: `${harness.extensionBaseUrl}/sidebar.html` });
    sidebarTabId = Number(/tabId=(\d+)/.exec(sidebar)![1]);
    expect(await call("tabs_context")).toMatch(
      /tabId=\d+ window=\d+ \[complete\] "Claude" moz-extension:/,
    );
  });

  it("streams a reply that saw the active tab, with the tool call and result", async () => {
    const { conversationId } = await bridge.request<{ conversationId: string }>("chat.send", {
      text: "What is this page about?",
      model: "haiku",
    });
    const conversation = await waitForTurnEnd(conversationId);
    expect(conversation.sessionId).toMatch(/^fake-session-/);
    expect(conversation.title).toBe("What is this page about?");
    const roles = conversation.items.map((item) => item.role);
    expect(roles).toEqual(["user", "tool", "assistant"]);
    expect(conversation.items[1]).toMatchObject({
      name: "mcp__claude-in-firefox__tabs_context",
      resultText: expect.stringContaining("tabId=1"),
      isError: false,
    });
    const reply = conversation.items[2] as { text: string; streaming: boolean };
    expect(reply.streaming).toBe(false);
    expect(reply.text).toContain(`tabId=${fixtureTabId} "Claude in Firefox fixture"`);
    expect(reply.text).toContain("Use tabId=");
    expect(reply.text).toMatch(/What is this page about\?$/);
    const log = readFileSync(harness.fakeClaudeLog, "utf8");
    expect(log).toContain('"--model=haiku"');
    expect(log).toContain("--allowedTools=mcp__claude-in-firefox");
  });

  it("keeps the same process for the next turn and shows a permission card when claude asks", async () => {
    const { conversationId } = await bridge.request<{ conversationId: string }>("chat.send", {
      text: "This one needs-permission",
    });
    const conversation = await waitForItem(conversationId, "permission");
    expect(conversation.busy).toBe(true);
    expect(conversation.items.at(-1)).toMatchObject({
      role: "permission",
      requestId: "perm-1",
      toolName: "Bash",
      input: { command: "touch probe.txt" },
    });
    const starts = readFileSync(harness.fakeClaudeLog, "utf8")
      .split("\n")
      .filter((l) => l.includes('"start"'));
    expect(starts).toHaveLength(1);
    await expect(bridge.request("chat.send", { text: "too early" })).rejects.toThrow(
      /still answering/,
    );
    await screenshotTab(sidebarTabId, "sidebar-chat.png");
    expect(existsSync("e2e/screenshots/sidebar-chat.png")).toBe(true);
  });

  it("rejects empty text and unknown conversations with helpful errors", async () => {
    await expect(bridge.request("chat.send", { text: "" })).rejects.toThrow(/non-empty string/);
    await expect(bridge.request("chat.transcript", { conversationId: "nope" })).rejects.toThrow(
      /unknown conversation "nope"/,
    );
  });
});
