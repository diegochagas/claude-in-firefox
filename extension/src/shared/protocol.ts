// Wire types shared by the three programs. The MCP server sends a BridgeRequest over the
// Unix socket, the native host forwards it to the extension background over native
// messaging, and the background answers with a BridgeResponse carrying the same id.

export interface BridgeRequest {
  id: string;
  method: BridgeMethod;
  params: Record<string, unknown>;
}

export interface BridgeResponse {
  id: string;
  result?: unknown;
  error?: string;
}

export type BridgeMethod =
  | "tabs.list"
  | "tabs.create"
  | "tabs.close"
  | "tabs.navigate"
  | "tabs.resize"
  | "page.screenshot"
  | "page.zoom"
  | "page.read"
  | "page.find"
  | "page.text"
  | "page.formInput"
  | "page.pointer"
  | "page.keyboard"
  | "page.scroll"
  | "page.scrollTo"
  | "page.evaluate"
  | "diagnostics.console"
  | "diagnostics.network";

export interface TabSummary {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
  status: string;
}

export interface ViewportInfo {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
}

export interface ScreenshotResult {
  pngBase64: string;
  imageWidth: number;
  imageHeight: number;
  viewport: ViewportInfo;
  /** Multiply image pixels by this factor to get viewport CSS pixels. */
  cssPixelsPerImagePixel: number;
}

export type PointerAction =
  "left_click" | "right_click" | "double_click" | "triple_click" | "hover" | "left_click_drag";

export interface PointerCommand {
  kind: "pointer";
  action: PointerAction;
  x?: number;
  y?: number;
  ref?: string;
  startX?: number;
  startY?: number;
  modifiers?: string;
}

export interface KeyboardCommand {
  kind: "keyboard";
  action: "type" | "key";
  text: string;
  repeat?: number;
}

export interface ScrollCommand {
  kind: "scroll";
  x: number;
  y: number;
  direction: "up" | "down" | "left" | "right";
  ticks: number;
}

export interface ScrollToCommand {
  kind: "scrollTo";
  ref: string;
}

export interface ReadPageCommand {
  kind: "read";
  filter: "interactive" | "all";
  depth: number;
  refId?: string;
  maxChars: number;
}

export interface FindCommand {
  kind: "find";
  query: string;
}

export interface PageTextCommand {
  kind: "text";
  maxChars: number;
}

export interface FormInputCommand {
  kind: "formInput";
  ref: string;
  value: unknown;
}

export interface EvaluateCommand {
  kind: "evaluate";
  code: string;
}

export interface ViewportCommand {
  kind: "viewport";
}

export type ContentCommand =
  | PointerCommand
  | KeyboardCommand
  | ScrollCommand
  | ScrollToCommand
  | ReadPageCommand
  | FindCommand
  | PageTextCommand
  | FormInputCommand
  | EvaluateCommand
  | ViewportCommand;

export interface FindMatch {
  ref: string;
  line: string;
}

export interface ConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
  url: string;
  timestamp: number;
}

/** Content script → background: a batch of console lines captured on the page. */
export interface ConsoleBatchMessage {
  kind: "consoleBatch";
  entries: ConsoleEntry[];
}

export interface NetworkEntry {
  requestId: string;
  method: string;
  url: string;
  type: string;
  status?: number;
  error?: string;
  startedAt: number;
  durationMs?: number;
  hasBody: boolean;
}
