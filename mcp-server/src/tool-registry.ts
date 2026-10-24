// Thin wrapper over the MCP SDK: one place that knows how tools are registered, so the rest
// of the server only writes plain async functions. Also keeps a by-name map for browser_batch.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export type ToolShape = Record<string, z.ZodTypeAny>;
export type ToolRunner = (input: Record<string, unknown>) => Promise<CallToolResult>;

export interface ToolDefinition<Shape extends ToolShape> {
  name: string;
  description: string;
  shape: Shape;
  run: (input: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult>;
}

export class ToolRegistry {
  private readonly runners = new Map<string, ToolRunner>();

  constructor(private readonly server: McpServer) {}

  define<Shape extends ToolShape>(tool: ToolDefinition<Shape>): void {
    const runner: ToolRunner = async (input) => {
      const parsed = z.object(tool.shape).parse(input);
      return tool.run(parsed as z.infer<z.ZodObject<Shape>>).catch(errorResult);
    };
    this.runners.set(tool.name, runner);
    // The SDK's callback generics are derived from the shape; the registry validates with zod
    // itself, so the callback only needs the raw argument object.
    const callback = (args: unknown) => runner(args as Record<string, unknown>);
    this.server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.shape },
      callback as never,
    );
  }

  /** Run a registered tool by name (used by browser_batch). */
  run(name: string, input: Record<string, unknown>): Promise<CallToolResult> {
    const runner = this.runners.get(name);
    if (!runner)
      throw new Error(
        `unknown tool "${name}": expected one of ${[...this.runners.keys()].join(", ")}`,
      );
    return runner(input);
  }

  names(): string[] {
    return [...this.runners.keys()];
  }
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function imageResult(pngBase64: string, caption: string): CallToolResult {
  return {
    content: [
      { type: "image", data: pngBase64, mimeType: "image/png" },
      { type: "text", text: caption },
    ],
  };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: `Error: ${message}` }] };
}
