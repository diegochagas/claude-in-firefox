import { z } from "zod";
import type { BridgeRequester } from "../bridge-client";
import { textResult, type ToolRegistry } from "../tool-registry";

export function registerWindowTool(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "resize_window",
    description:
      "Emulate a viewport size by resizing the tab's window. Presets: mobile (375×812), tablet (768×1024), desktop (restore the original size). Custom sizes need width and height. Firefox cannot emulate prefers-color-scheme per tab from an extension, so colorScheme is not supported.",
    shape: {
      preset: z.enum(["mobile", "tablet", "desktop"]).optional(),
      width: z.number().int().min(200).max(4000).optional(),
      height: z.number().int().min(200).max(4000).optional(),
      tabId: z
        .number()
        .optional()
        .describe("Tab whose window to resize; defaults to the active tab"),
    },
    run: async ({ preset, width, height, tabId }) =>
      textResult(await bridge.request<string>("tabs.resize", { tabId, preset, width, height })),
  });
}
