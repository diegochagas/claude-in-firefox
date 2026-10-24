import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { textResult, type ToolRegistry } from "../tool-registry";

const batchItem = z.object({
  name: z.string().describe("Tool name, e.g. computer, navigate, find, form_input, read_page"),
  input: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("That tool's input, exactly as when calling it directly"),
});

function labelStep(index: number, name: string): CallToolResult["content"][number] {
  return { type: "text", text: `--- step ${index + 1}: ${name}` };
}

/** Run the items in order, stopping at the first error; results are concatenated. */
export async function runBatch(
  registry: ToolRegistry,
  items: z.infer<typeof batchItem>[],
): Promise<CallToolResult> {
  const content: CallToolResult["content"] = [];
  for (const [index, item] of items.entries()) {
    if (item.name === "browser_batch") return stopBatch(content, "browser_batch cannot be nested");
    const result = await registry.run(item.name, item.input);
    content.push(labelStep(index, item.name), ...result.content);
    if (result.isError) return stopBatch(content, `batch stopped at step ${index + 1}`);
  }
  return { content };
}

function stopBatch(content: CallToolResult["content"], reason: string): CallToolResult {
  return { isError: true, content: [...content, ...textResult(reason).content] };
}

export function registerBatchTool(registry: ToolRegistry): void {
  registry.define({
    name: "browser_batch",
    description:
      "Run several browser tool calls in one round trip, sequentially, stopping at the first error. Each item is {name, input}. Coordinates in the batch refer to the screenshot taken before it.",
    shape: { actions: z.array(batchItem).min(1).max(50) },
    run: ({ actions }) => runBatch(registry, actions),
  });
}
