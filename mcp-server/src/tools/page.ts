import { z } from "zod";
import type { FindMatch } from "../../../extension/src/shared/protocol";
import type { BridgeRequester } from "../bridge-client";
import { textResult, type ToolRegistry } from "../tool-registry";

const tabIdShape = z.number().optional().describe("Tab to read; defaults to the active tab");

export function formatFindMatches(query: string, matches: FindMatch[]): string {
  if (matches.length === 0) return `no element matches ${JSON.stringify(query)}`;
  return matches.map((match) => `- ${match.line}`).join("\n");
}

const readPageShape = {
  filter: z
    .enum(["interactive", "all"])
    .optional()
    .describe(
      '"interactive": only clickable/typable elements, flat. "all" (default): the full outline',
    ),
  depth: z.number().int().min(1).max(60).optional().describe("Max tree depth (default 15)"),
  ref_id: z.string().optional().describe("Only the subtree of this ref"),
  max_chars: z
    .number()
    .int()
    .min(500)
    .max(500_000)
    .optional()
    .describe("Truncate the output (default 50000)"),
  tabId: tabIdShape,
};

function registerReadPage(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "read_page",
    description:
      "Read the page as an indented accessibility-style outline: role, name, state and a [ref_N] tag per element. Prefer it over screenshots to check text and structure; refs feed computer (click/scroll_to) and form_input.",
    shape: readPageShape,
    run: async ({ filter, depth, ref_id, max_chars, tabId }) =>
      textResult(
        await bridge.request<string>("page.read", {
          tabId,
          filter: filter ?? "all",
          depth: depth ?? 15,
          refId: ref_id,
          maxChars: max_chars ?? 50_000,
        }),
      ),
  });
}

function registerFind(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "find",
    description:
      "Find elements whose role, name or text contains a query (case-insensitive). Returns up to 20 matches with refs for computer/form_input.",
    shape: {
      query: z.string().describe('Text to look for, e.g. "Sign in", "search", "Add to cart"'),
      tabId: tabIdShape,
    },
    run: async ({ query, tabId }) =>
      textResult(
        formatFindMatches(query, await bridge.request<FindMatch[]>("page.find", { tabId, query })),
      ),
  });
}

function registerFormInput(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "form_input",
    description:
      "Set a form element's value by ref: text inputs/textareas, selects (option value or text), checkboxes/radios (boolean) and contenteditable. Fires input and change events.",
    shape: {
      ref: z.string().describe("Element ref from read_page/find"),
      value: z
        .union([z.string(), z.number(), z.boolean()])
        .describe("New value; boolean for checkboxes"),
      tabId: tabIdShape,
    },
    run: async ({ ref, value, tabId }) =>
      textResult(await bridge.request<string>("page.formInput", { tabId, ref, value })),
  });
}

function registerPageText(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "get_page_text",
    description:
      "Visible text of the page: article/main content first, falling back to the whole body.",
    shape: {
      max_chars: z.number().int().min(100).max(1_000_000).optional().describe("Default 50000"),
      tabId: tabIdShape,
    },
    run: async ({ max_chars, tabId }) =>
      textResult(
        await bridge.request<string>("page.text", { tabId, maxChars: max_chars ?? 50_000 }),
      ),
  });
}

export function registerPageTools(registry: ToolRegistry, bridge: BridgeRequester): void {
  registerReadPage(registry, bridge);
  registerFind(registry, bridge);
  registerFormInput(registry, bridge);
  registerPageText(registry, bridge);
}
