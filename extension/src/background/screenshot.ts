// Screenshots via tabs.captureTab, which works on background tabs too. Captures at scale 1 so
// one image pixel equals one CSS pixel and the model's coordinates map straight onto the page.
import type { ScreenshotResult, ViewportInfo } from "../shared/protocol";
import { resolveTabId } from "./active-tab";
import { sendToContent } from "./content-bridge";

const ZOOM_LONGEST_SIDE = 1200;
const MAX_ZOOM_SCALE = 4;

interface ZoomRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

async function screenshotResult(
  dataUrl: string,
  viewport: ViewportInfo,
  magnification: number,
): Promise<ScreenshotResult> {
  const size = await pngSize(dataUrl);
  return {
    pngBase64: stripDataUrl(dataUrl),
    imageWidth: size.width,
    imageHeight: size.height,
    viewport,
    cssPixelsPerImagePixel: 1 / magnification,
  };
}

async function pngSize(dataUrl: string): Promise<{ width: number; height: number }> {
  // IHDR width/height sit at bytes 16–24; 32 base64 chars decode to the first 24 bytes.
  const bytes = atob(stripDataUrl(dataUrl).slice(0, 32)).slice(16, 24);
  const view = new DataView(Uint8Array.from(bytes, (char) => char.charCodeAt(0)).buffer);
  return { width: view.getUint32(0), height: view.getUint32(4) };
}

/**
 * Pages without a content script (the extension's own sidebar.html in a tab) still capture;
 * their viewport is the tab's size, unscrolled.
 */
async function viewportFromTab(tabId: number): Promise<ViewportInfo> {
  const tab = await browser.tabs.get(tabId);
  return {
    width: tab.width ?? 0,
    height: tab.height ?? 0,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 1,
  };
}

export async function captureViewport(tabId: unknown, scale: unknown): Promise<ScreenshotResult> {
  const id = await resolveTabId(tabId);
  const factor = typeof scale === "number" && scale > 0 && scale <= 1 ? scale : 1;
  const viewport = await sendToContent<ViewportInfo>(id, { kind: "viewport" }).catch(() =>
    viewportFromTab(id),
  );
  const dataUrl = await browser.tabs.captureTab(id, { format: "png", scale: factor });
  return screenshotResult(dataUrl, viewport, factor);
}

function validateRegion(region: unknown): ZoomRegion {
  const list = Array.isArray(region) ? region.map(Number) : [];
  const [x0, y0, x1, y1] = list;
  if (list.length !== 4 || list.some(Number.isNaN) || x1! <= x0! || y1! <= y0!) {
    throw new Error(
      `zoom region must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0: got ${JSON.stringify(region)}`,
    );
  }
  return { x0: x0!, y0: y0!, x1: x1!, y1: y1! };
}

function zoomMagnification(zoom: ZoomRegion, scale: unknown): number {
  const requested = typeof scale === "number" && scale > 0 && scale <= 1 ? scale : 1;
  const longest = Math.max(zoom.x1 - zoom.x0, zoom.y1 - zoom.y0);
  return Math.min(MAX_ZOOM_SCALE, ZOOM_LONGEST_SIDE / longest) * requested;
}

/** Capture a viewport region magnified so its longest side is about 1200px. */
export async function captureZoom(
  tabId: unknown,
  region: unknown,
  scale: unknown,
): Promise<ScreenshotResult> {
  const id = await resolveTabId(tabId);
  const zoom = validateRegion(region);
  const viewport = await sendToContent<ViewportInfo>(id, { kind: "viewport" });
  const magnification = zoomMagnification(zoom, scale);
  // captureTab's rect is relative to the document, the model's region to the viewport.
  const rect = {
    x: zoom.x0 + viewport.scrollX,
    y: zoom.y0 + viewport.scrollY,
    width: zoom.x1 - zoom.x0,
    height: zoom.y1 - zoom.y0,
  };
  const dataUrl = await browser.tabs.captureTab(id, { format: "png", rect, scale: magnification });
  return screenshotResult(dataUrl, viewport, magnification);
}
