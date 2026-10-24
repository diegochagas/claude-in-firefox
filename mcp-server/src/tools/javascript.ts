import { z } from "zod";
import type { BridgeRequester } from "../bridge-client";
import { textResult, type ToolRegistry } from "../tool-registry";

export function registerJavascriptTool(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "javascript_tool",
    description:
      "Evaluate JavaScript in the page for debugging and inspection, with console semantics: top-level await works and the last expression is returned as JSON. Do not use it to implement UI changes; edit source code instead.",
    shape: {
      action: z.literal("javascript_exec").optional().describe("Only javascript_exec is supported"),
      text: z
        .string()
        .describe(
          "The code to run, e.g. `document.title` or `await fetch(url).then(r => r.json())`",
        ),
      tabId: z.number().optional().describe("Tab to run in; defaults to the active tab"),
    },
    run: async ({ text, tabId }) =>
      textResult(await bridge.request<string>("page.evaluate", { tabId, code: text })),
  });
}
