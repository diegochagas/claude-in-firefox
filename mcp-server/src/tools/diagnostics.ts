import { z } from "zod";
import type { BridgeRequester } from "../bridge-client";
import { textResult, type ToolRegistry } from "../tool-registry";

const tabIdShape = z.number().optional().describe("Tab to inspect; defaults to the active tab");

const consoleShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max entries (default 50, newest last)"),
  onlyErrors: z.boolean().optional().describe("Only error-level entries"),
  pattern: z.string().optional().describe("Substring filter on the message text"),
  tabId: tabIdShape,
};

const networkShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(300)
    .optional()
    .describe("Max entries when listing (default 50)"),
  urlPattern: z.string().optional().describe("Substring filter on the URL"),
  requestId: z
    .string()
    .optional()
    .describe("Return this request's response body instead of listing"),
  tabId: tabIdShape,
};

function registerConsoleTool(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "read_console_messages",
    description:
      "Console output (log, info, warn, error, debug) and uncaught errors captured on the page since it loaded.",
    shape: consoleShape,
    run: async (query) => textResult(await bridge.request<string>("diagnostics.console", query)),
  });
}

function registerNetworkTool(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "read_network_requests",
    description:
      "List the tab's network requests (requestId, method, status, type, URL; credential-looking query values show as REDACTED), or pass requestId to get the stored response body of an XHR/fetch request.",
    shape: networkShape,
    run: async (query) => textResult(await bridge.request<string>("diagnostics.network", query)),
  });
}

export function registerDiagnosticTools(registry: ToolRegistry, bridge: BridgeRequester): void {
  registerConsoleTool(registry, bridge);
  registerNetworkTool(registry, bridge);
}
