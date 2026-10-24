import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createFirefoxMcpServer } from "../mcp-server/src/main";
import { describeScreenshot } from "../mcp-server/src/tools/computer";
import { FakeBridge } from "./fakes/fake-bridge";

const TAB = {
  tabId: 3,
  windowId: 1,
  url: "https://example.test/",
  title: "Example",
  active: true,
  status: "complete",
};
const SHOT = {
  pngBase64: "iVBORw0KGgo=",
  imageWidth: 1280,
  imageHeight: 720,
  viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 40, devicePixelRatio: 1 },
  cssPixelsPerImagePixel: 1,
};
const EXPECTED_TOOLS = [
  "tabs_context",
  "tabs_create",
  "tabs_close",
  "navigate",
  "computer",
  "read_page",
  "find",
  "form_input",
  "get_page_text",
  "javascript_tool",
  "read_console_messages",
  "read_network_requests",
  "resize_window",
  "browser_batch",
];

async function connectedClient(bridge: FakeBridge): Promise<Client> {
  const { server } = createFirefoxMcpServer(bridge);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP server", () => {
  it("exposes the Claude-in-Chrome tool set", async () => {
    const client = await connectedClient(new FakeBridge());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("forwards navigate and tabs_context to the bridge with the tab id", async () => {
    const bridge = new FakeBridge({
      "tabs.navigate": { ...TAB, loaded: true },
      "tabs.list": [TAB],
    });
    const client = await connectedClient(bridge);
    const navigation = await client.callTool({
      name: "navigate",
      arguments: { url: "example.test", tabId: 3 },
    });
    expect(navigation.content).toEqual([
      { type: "text", text: 'tabId=3 loaded: "Example" https://example.test/' },
    ]);
    expect(bridge.requests[0]).toEqual({
      method: "tabs.navigate",
      params: { url: "example.test", tabId: 3 },
    });
    const tabs = await client.callTool({ name: "tabs_context", arguments: {} });
    expect((tabs.content as { text: string }[])[0]!.text).toBe(
      '* tabId=3 window=1 [complete] "Example" https://example.test/',
    );
  });

  it("returns screenshots as image content with a coordinate note", async () => {
    const client = await connectedClient(new FakeBridge({ "page.screenshot": SHOT }));
    const result = await client.callTool({ name: "computer", arguments: { action: "screenshot" } });
    const [image, note] = result.content as { type: string; mimeType?: string; text?: string }[];
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(note!.text).toBe(describeScreenshot(SHOT, "screenshot"));
    expect(note!.text).toContain("coordinates map 1:1");
  });

  it("maps coordinate clicks and key presses onto bridge params", async () => {
    const bridge = new FakeBridge({
      "page.pointer": "left_click at (10, 20) on button",
      "page.keyboard": "pressed Return",
    });
    const client = await connectedClient(bridge);
    await client.callTool({
      name: "computer",
      arguments: { action: "left_click", coordinate: [10, 20], modifiers: "shift" },
    });
    await client.callTool({
      name: "computer",
      arguments: { action: "key", text: "Return", repeat: 2 },
    });
    expect(bridge.requests[0]!.params).toMatchObject({
      action: "left_click",
      x: 10,
      y: 20,
      modifiers: "shift",
    });
    expect(bridge.requests[1]!.params).toMatchObject({ action: "key", text: "Return", repeat: 2 });
  });

  it("turns bridge failures into isError results instead of protocol errors", async () => {
    const client = await connectedClient(
      new FakeBridge({ "page.find": new Error('unknown ref "ref_9"') }),
    );
    const result = await client.callTool({ name: "find", arguments: { query: "x" } });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toBe('Error: unknown ref "ref_9"');
  });

  it("rejects invalid arguments with a readable validation error", async () => {
    const client = await connectedClient(new FakeBridge());
    const result = await client.callTool({ name: "computer", arguments: { action: "fly" } });
    expect(result.isError).toBe(true);
  });

  it("runs browser_batch in order and stops at the first error", async () => {
    const bridge = new FakeBridge({
      "page.find": [],
      "page.text": "hello",
      "page.formInput": new Error("not a form element"),
    });
    const client = await connectedClient(bridge);
    const result = await client.callTool({
      name: "browser_batch",
      arguments: {
        actions: [
          { name: "find", input: { query: "a" } },
          { name: "form_input", input: { ref: "ref_1", value: "x" } },
          { name: "get_page_text", input: {} },
        ],
      },
    });
    const texts = (result.content as { text: string }[]).map((item) => item.text);
    expect(result.isError).toBe(true);
    expect(texts).toEqual([
      "--- step 1: find",
      'no element matches "a"',
      "--- step 2: form_input",
      "Error: not a form element",
      "batch stopped at step 2",
    ]);
    expect(bridge.requests.map((request) => request.method)).toEqual([
      "page.find",
      "page.formInput",
    ]);
  });
});
