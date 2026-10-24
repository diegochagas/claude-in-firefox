// The `computer` tool: mouse, keyboard, scrolling and screenshots, mirroring Claude in Chrome's
// action names so existing prompts and skills transfer.
import { z } from "zod";
import type { ScreenshotResult } from "../../../extension/src/shared/protocol";
import type { BridgeRequester } from "../bridge-client";
import { imageResult, textResult, type ToolRegistry } from "../tool-registry";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const POINTER_ACTIONS = new Set([
  "left_click",
  "right_click",
  "double_click",
  "triple_click",
  "hover",
  "left_click_drag",
]);

const computerShape = {
  action: z
    .enum([
      "screenshot",
      "left_click",
      "right_click",
      "double_click",
      "triple_click",
      "left_click_drag",
      "hover",
      "type",
      "key",
      "scroll",
      "scroll_to",
      "zoom",
      "wait",
    ])
    .describe("What to do"),
  coordinate: z
    .array(z.number())
    .length(2)
    .optional()
    .describe("[x, y] in the frame of the latest screenshot (CSS pixels of the viewport)"),
  start_coordinate: z
    .array(z.number())
    .length(2)
    .optional()
    .describe("left_click_drag: where the drag starts"),
  ref: z
    .string()
    .optional()
    .describe(
      "Element ref (ref_N from read_page/find) as an alternative to coordinate; required for scroll_to",
    ),
  text: z
    .string()
    .optional()
    .describe(
      'type: the text to type. key: space-separated keys, e.g. "Return", "ctrl+a Backspace", "shift+Tab"',
    ),
  modifiers: z
    .string()
    .optional()
    .describe(
      'Modifier keys held during a click: "ctrl", "shift", "alt", "cmd", combinable with "+"',
    ),
  scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
  scroll_amount: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Wheel ticks (default 3, 100px each)"),
  duration: z.number().min(0).max(10).optional().describe("wait: seconds to wait"),
  region: z
    .array(z.number())
    .length(4)
    .optional()
    .describe("zoom: [x0, y0, x1, y1] viewport region to magnify"),
  scale: z
    .number()
    .min(0.1)
    .max(1)
    .optional()
    .describe("screenshot/zoom: shrink the returned image (coordinates stay in viewport pixels)"),
  repeat: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("key: repeat the sequence this many times"),
  tabId: z.number().optional().describe("Tab to act on; defaults to the active tab"),
};
type ComputerInput = z.infer<z.ZodObject<typeof computerShape>>;

export function describeScreenshot(shot: ScreenshotResult, kind: "screenshot" | "zoom"): string {
  const frame =
    shot.cssPixelsPerImagePixel === 1
      ? "coordinates map 1:1 to this image"
      : `multiply image pixels by ${shot.cssPixelsPerImagePixel.toFixed(3)} to get viewport coordinates`;
  const viewport = `viewport ${shot.viewport.width}×${shot.viewport.height} CSS px, scrolled to (${shot.viewport.scrollX}, ${shot.viewport.scrollY})`;
  return `${kind} ${shot.imageWidth}×${shot.imageHeight}; ${viewport}; ${frame}`;
}

async function screenshot(bridge: BridgeRequester, input: ComputerInput): Promise<CallToolResult> {
  const shot = await bridge.request<ScreenshotResult>("page.screenshot", {
    tabId: input.tabId,
    scale: input.scale,
  });
  return imageResult(shot.pngBase64, describeScreenshot(shot, "screenshot"));
}

async function zoom(bridge: BridgeRequester, input: ComputerInput): Promise<CallToolResult> {
  const shot = await bridge.request<ScreenshotResult>("page.zoom", {
    tabId: input.tabId,
    region: input.region,
    scale: input.scale,
  });
  return imageResult(
    shot.pngBase64,
    `${describeScreenshot(shot, "zoom")}; region [${input.region?.join(", ")}]`,
  );
}

function pointer(bridge: BridgeRequester, input: ComputerInput): Promise<CallToolResult> {
  const [x, y] = input.coordinate ?? [];
  const [startX, startY] = input.start_coordinate ?? [];
  return bridge
    .request<string>("page.pointer", {
      tabId: input.tabId,
      action: input.action,
      x,
      y,
      ref: input.ref,
      startX,
      startY,
      modifiers: input.modifiers,
    })
    .then(textResult);
}

function keyboard(bridge: BridgeRequester, input: ComputerInput): Promise<CallToolResult> {
  if (!input.text) throw new Error(`${input.action} needs "text"`);
  return bridge
    .request<string>("page.keyboard", {
      tabId: input.tabId,
      action: input.action,
      text: input.text,
      repeat: input.repeat,
    })
    .then(textResult);
}

function scroll(bridge: BridgeRequester, input: ComputerInput): Promise<CallToolResult> {
  if (!input.coordinate || !input.scroll_direction)
    throw new Error("scroll needs coordinate and scroll_direction");
  const [x, y] = input.coordinate;
  return bridge
    .request<string>("page.scroll", {
      tabId: input.tabId,
      x,
      y,
      direction: input.scroll_direction,
      ticks: input.scroll_amount ?? 3,
    })
    .then(textResult);
}

async function wait(input: ComputerInput): Promise<CallToolResult> {
  const seconds = input.duration ?? 1;
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  return textResult(`waited ${seconds}s`);
}

function runComputer(bridge: BridgeRequester, input: ComputerInput): Promise<CallToolResult> {
  if (input.action === "screenshot") return screenshot(bridge, input);
  if (input.action === "zoom") return zoom(bridge, input);
  if (input.action === "wait") return wait(input);
  if (input.action === "scroll") return scroll(bridge, input);
  if (input.action === "scroll_to")
    return bridge
      .request<string>("page.scrollTo", { tabId: input.tabId, ref: input.ref })
      .then(textResult);
  if (input.action === "type" || input.action === "key") return keyboard(bridge, input);
  if (POINTER_ACTIONS.has(input.action)) return pointer(bridge, input);
  throw new Error(`unsupported action "${input.action}"`);
}

export function registerComputerTool(registry: ToolRegistry, bridge: BridgeRequester): void {
  registry.define({
    name: "computer",
    description:
      "Mouse and keyboard on the page, plus screenshots. Actions: screenshot (returns the viewport as PNG; coordinates for later clicks are pixels of that image), left_click/right_click/double_click/triple_click/hover at a coordinate or ref, left_click_drag from start_coordinate to coordinate, type (text into the focused element), key (key combos like Return, Tab, ctrl+a), scroll (at a coordinate), scroll_to (a ref), zoom (magnify a region), wait. Take a fresh screenshot after the page changes before clicking by coordinate. Events are synthetic: file pickers and popups that need a real user gesture will not open.",
    shape: computerShape,
    run: (input) => runComputer(bridge, input),
  });
}
