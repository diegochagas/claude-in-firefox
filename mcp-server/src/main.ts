// MCP server entry (stdio). Claude Code starts it; it talks to Firefox through the native host.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient, type BridgeRequester } from "./bridge-client";
import { ToolRegistry } from "./tool-registry";
import { registerBatchTool } from "./tools/batch";
import { registerComputerTool } from "./tools/computer";
import { registerDiagnosticTools } from "./tools/diagnostics";
import { registerJavascriptTool } from "./tools/javascript";
import { registerNavigateTool } from "./tools/navigate";
import { registerPageTools } from "./tools/page";
import { registerTabTools } from "./tools/tabs";
import { registerWindowTool } from "./tools/window";

export const SERVER_NAME = "claude-in-firefox";
export const SERVER_VERSION = "0.1.0";

/** Build the server with every tool registered; the bridge is injectable for tests. */
export function createFirefoxMcpServer(bridge: BridgeRequester = new BridgeClient()): {
  server: McpServer;
  registry: ToolRegistry;
} {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const registry = new ToolRegistry(server);
  registerTabTools(registry, bridge);
  registerNavigateTool(registry, bridge);
  registerComputerTool(registry, bridge);
  registerPageTools(registry, bridge);
  registerJavascriptTool(registry, bridge);
  registerDiagnosticTools(registry, bridge);
  registerWindowTool(registry, bridge);
  registerBatchTool(registry);
  return { server, registry };
}

async function main(): Promise<void> {
  const { server } = createFirefoxMcpServer();
  await server.connect(new StdioServerTransport());
}

const startedAsProgram = process.argv[1]?.endsWith("mcp-server.js") ?? false;
if (startedAsProgram) {
  main().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ event: "fatal", error: String(error) })}\n`);
    process.exit(1);
  });
}
