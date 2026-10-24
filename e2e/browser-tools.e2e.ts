// End-to-end: real headless Firefox + extension + native host + MCP server, driven through an
// in-memory MCP client exactly as Claude Code would call the tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../mcp-server/src/bridge-client";
import { createFirefoxMcpServer } from "../mcp-server/src/main";
import { startFirefoxHarness, type FirefoxHarness } from "./firefox-harness";

let harness: FirefoxHarness;
let client: Client;
let bridge: BridgeClient;
let fixtureTabId: number;

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const texts = (result.content as TextContent[])
    .filter((item) => item.type === "text")
    .map((item) => item.text);
  if (result.isError) throw new Error(`${name} failed: ${texts.join("\n")}`);
  return texts.join("\n");
}

async function callForImage(
  args: Record<string, unknown>,
  file: string,
): Promise<{ image: ImageContent; note: string }> {
  const result = await client.callTool({ name: "computer", arguments: args });
  expect(result.isError).toBeFalsy();
  const [image, note] = result.content as [ImageContent, TextContent];
  expect(image.mimeType).toBe("image/png");
  mkdirSync("e2e/screenshots", { recursive: true });
  writeFileSync(`e2e/screenshots/${file}`, Buffer.from(image.data, "base64"));
  return { image, note: note.text };
}

async function evaluate(code: string): Promise<string> {
  return call("javascript_tool", { text: code, tabId: fixtureTabId });
}

beforeAll(async () => {
  harness = await startFirefoxHarness();
  bridge = new BridgeClient(harness.socketPath);
  const { server } = createFirefoxMcpServer(bridge);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "e2e", version: "0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  bridge?.close();
  await harness?.stop();
});

describe("tabs and navigation", () => {
  it("lists tabs and navigates the fixture tab", async () => {
    const created = await call("tabs_create", { url: `${harness.baseUrl}/index.html` });
    fixtureTabId = Number(/tabId=(\d+)/.exec(created)![1]);
    const tabs = await call("tabs_context");
    expect(tabs).toContain(`tabId=${fixtureTabId}`);
    const navigated = await call("navigate", {
      url: `${harness.baseUrl}/second.html`,
      tabId: fixtureTabId,
    });
    expect(navigated).toContain('loaded: "Second page"');
    expect(await call("navigate", { url: "back", tabId: fixtureTabId })).toContain(
      "Claude in Firefox fixture",
    );
  });
});

describe("reading the page", () => {
  it("read_page returns the outline with refs, find locates elements, get_page_text returns text", async () => {
    const outline = await call("read_page", { tabId: fixtureTabId });
    expect(outline).toMatch(/heading "Fixture page" \[ref_\d+\] level=1/);
    expect(outline).toMatch(/link "Second page" \[ref_\d+\] href="\/second.html"/);
    expect(outline).toMatch(/textbox "Query" \[ref_\d+\]/);
    const interactive = await call("read_page", { tabId: fixtureTabId, filter: "interactive" });
    expect(interactive).not.toContain("heading");
    expect(await call("find", { query: "increment", tabId: fixtureTabId })).toMatch(
      /button "Increment" \[ref_\d+\]/,
    );
    expect(await call("get_page_text", { tabId: fixtureTabId })).toContain("Bottom of the page");
  });
});

describe("interacting", () => {
  beforeEach(() => call("navigate", { url: `${harness.baseUrl}/index.html`, tabId: fixtureTabId }));

  it("clicks by ref and by coordinate, and the page reacts", async () => {
    const ref = /\[(ref_\d+)\]/.exec(
      await call("find", { query: 'button "Increment"', tabId: fixtureTabId }),
    )![1];
    expect(await call("computer", { action: "left_click", ref, tabId: fixtureTabId })).toContain(
      'on button "Increment"',
    );
    const where = /\((\d+), (\d+)\)/.exec(
      await call("computer", { action: "hover", ref, tabId: fixtureTabId }),
    )!;
    await call("computer", {
      action: "left_click",
      coordinate: [Number(where[1]), Number(where[2])],
      tabId: fixtureTabId,
    });
    expect(await evaluate("window.fixtureState.clicks")).toBe("2");
    expect(await evaluate("document.getElementById('counter').textContent")).toBe('"2"');
  });

  it("types into inputs, fills forms and submits with Return", async () => {
    const query = /\[(ref_\d+)\]/.exec(
      await call("find", { query: 'textbox "Query"', tabId: fixtureTabId }),
    )![1];
    await call("computer", { action: "left_click", ref: query, tabId: fixtureTabId });
    await call("computer", { action: "type", text: "Pegasus Seiya", tabId: fixtureTabId });
    expect(await evaluate("document.getElementById('typed').textContent")).toBe('"Pegasus Seiya"');
    const country = /\[(ref_\d+)\]/.exec(
      await call("find", { query: "combobox", tabId: fixtureTabId }),
    )![1];
    expect(
      await call("form_input", { ref: country, value: "New Zealand", tabId: fixtureTabId }),
    ).toContain('"New Zealand"');
    const agree = /\[(ref_\d+)\]/.exec(
      await call("find", { query: "checkbox", tabId: fixtureTabId }),
    )![1];
    expect(await call("form_input", { ref: agree, value: true, tabId: fixtureTabId })).toContain(
      "checked",
    );
    await call("computer", { action: "key", text: "ctrl+a", tabId: fixtureTabId });
    await call("computer", { action: "type", text: "Dragon Shiryu", tabId: fixtureTabId });
    const submitted = await call("computer", {
      action: "key",
      text: "Return",
      tabId: fixtureTabId,
    });
    expect(submitted).toMatch(
      /page navigated to .*second\.html\?q=Dragon\+Shiryu&country=nz&agree=on/,
    );
    expect(await call("get_page_text", { tabId: fixtureTabId })).toContain("query=Dragon Shiryu");
  });

  it("types into a contenteditable editor", async () => {
    const editor = /\[(ref_\d+)\]/.exec(
      await call("find", { query: 'textbox "Notes"', tabId: fixtureTabId }),
    )![1];
    await call("computer", { action: "left_click", ref: editor, tabId: fixtureTabId });
    await call("computer", { action: "key", text: "End", tabId: fixtureTabId });
    await call("computer", { action: "type", text: "world", tabId: fixtureTabId });
    // evaluate returns JSON, so the string comes back quoted.
    expect(JSON.parse(await evaluate("document.getElementById('editor').textContent"))).toMatch(
      /world$/,
    );
  });

  it("scrolls the window and inner containers, and scroll_to brings a ref into view", async () => {
    expect(
      await call("computer", {
        action: "scroll",
        coordinate: [300, 300],
        scroll_direction: "down",
        scroll_amount: 5,
        tabId: fixtureTabId,
      }),
    ).toContain("scrolled window by (0, 500)");
    expect(await evaluate("window.scrollY")).toBe("500");
    await call("computer", {
      action: "scroll",
      coordinate: [300, 300],
      scroll_direction: "up",
      scroll_amount: 10,
      tabId: fixtureTabId,
    });
    const bottom = /\[(ref_\d+)\]/.exec(
      await call("find", { query: "Bottom of the page", tabId: fixtureTabId }),
    )![1];
    expect(
      await call("computer", { action: "scroll_to", ref: bottom, tabId: fixtureTabId }),
    ).toContain("is now at viewport");
    expect(Number(await evaluate("window.scrollY"))).toBeGreaterThan(1000);
    await call("computer", {
      action: "scroll_to",
      ref: /\[(ref_\d+)\]/.exec(
        await call("find", { query: 'heading "Fixture page"', tabId: fixtureTabId }),
      )![1],
      tabId: fixtureTabId,
    });
  });
});

describe("screenshots", () => {
  it("captures the viewport and a zoomed region as PNG", async () => {
    const shot = await callForImage(
      { action: "screenshot", tabId: fixtureTabId },
      "fixture-viewport.png",
    );
    expect(shot.note).toMatch(/^screenshot \d+×\d+; viewport \d+×\d+ CSS px/);
    expect(shot.note).toContain("coordinates map 1:1");
    const zoom = await callForImage(
      { action: "zoom", region: [0, 0, 300, 100], tabId: fixtureTabId },
      "fixture-zoom-header.png",
    );
    expect(zoom.note).toMatch(/^zoom 1200×\d+/);
    const small = await callForImage(
      { action: "screenshot", scale: 0.5, tabId: fixtureTabId },
      "fixture-viewport-half.png",
    );
    expect(small.note).toContain("multiply image pixels by 2.000");
  });
});

describe("diagnostics", () => {
  it("captures console output, uncaught errors and network requests with bodies", async () => {
    const consoleText = await call("read_console_messages", { tabId: fixtureTabId });
    expect(consoleText).toContain('LOG fixture loaded {"ready":true}');
    expect(consoleText).toContain("ERROR fixture error example");
    expect(
      await call("read_console_messages", { tabId: fixtureTabId, onlyErrors: true }),
    ).not.toContain("fixture loaded");
    const network = await call("read_network_requests", {
      tabId: fixtureTabId,
      urlPattern: "data.json",
    });
    const requestId = /^(\S+) GET 200 xmlhttprequest .*data\.json \[body\]/m.exec(network)![1];
    expect(await call("read_network_requests", { requestId, tabId: fixtureTabId })).toContain(
      '"items": [1, 2, 3]',
    );
  });

  it("evaluates JavaScript with await and reports errors as text", async () => {
    expect(await evaluate("await fetch('/api/data.json').then(r => r.json())")).toContain(
      '"secret": false',
    );
    expect(await evaluate("const x = 1; x + 41")).toBe("42");
    expect(await evaluate("nope.missing")).toMatch(/^Error: ReferenceError/);
  });
});

describe("window and errors", () => {
  it("resizes the viewport and restores it", async () => {
    expect(await call("resize_window", { preset: "mobile", tabId: fixtureTabId })).toContain(
      "375×812",
    );
    expect(await call("resize_window", { preset: "desktop", tabId: fixtureTabId })).toMatch(
      /restored|unchanged/,
    );
  });

  it("returns tool errors for unknown refs and privileged pages", async () => {
    await expect(
      call("computer", { action: "left_click", ref: "ref_99999", tabId: fixtureTabId }),
    ).rejects.toThrow(/unknown ref "ref_99999"/);
    const blank = Number(/tabId=(\d+)/.exec(await call("tabs_create", {}))![1]);
    await expect(call("read_page", { tabId: blank })).rejects.toThrow(/cannot access tab|about:/);
    expect(await call("tabs_close", { tabId: blank })).toContain(`closed tab ${blank}`);
  });
});
