// Records requests per tab with webRequest and keeps the bodies of XHR/fetch responses (text,
// capped) via filterResponseData so read_network_requests can return them by requestId.
import type { NetworkEntry } from "../shared/protocol";
import { resolveTabId } from "./active-tab";
import { forgetDrivenTab, isTabDriven } from "./driven-tabs";
import { PerTabRingBuffer } from "./ring-buffer";
import { redactUrl } from "./redact-url";

const requestLog = new PerTabRingBuffer<NetworkEntry>(300);
const bodiesByRequestId = new Map<string, string>();
const BODY_TYPES = new Set(["xmlhttprequest"]);
const MAX_BODY_CHARS = 262_144;
const MAX_BODIES = 100;

interface NetworkQuery {
  tabId?: unknown;
  limit?: number;
  urlPattern?: string;
  requestId?: string;
}

function rememberBody(requestId: string, body: string): void {
  bodiesByRequestId.set(requestId, body.slice(0, MAX_BODY_CHARS));
  if (bodiesByRequestId.size > MAX_BODIES)
    bodiesByRequestId.delete(bodiesByRequestId.keys().next().value!);
}

function captureBody(details: browser.webRequest._OnBeforeRequestDetails): void {
  const filter = browser.webRequest.filterResponseData(details.requestId);
  const decoder = new TextDecoder("utf-8");
  let body = "";
  filter.ondata = (event) => {
    if (body.length < MAX_BODY_CHARS) body += decoder.decode(event.data, { stream: true });
    filter.write(event.data);
  };
  filter.onstop = () => {
    rememberBody(details.requestId, body);
    filter.close();
  };
  filter.onerror = () => filter.disconnect();
}

function onBeforeRequest(details: browser.webRequest._OnBeforeRequestDetails): void {
  if (details.tabId < 0) return;
  const wantsBody = BODY_TYPES.has(details.type) && isTabDriven(details.tabId);
  requestLog.push(details.tabId, {
    requestId: details.requestId,
    method: details.method,
    url: redactUrl(details.url),
    type: details.type,
    startedAt: details.timeStamp,
    hasBody: wantsBody,
  });
  if (wantsBody) captureBody(details);
}

function updateEntry(
  tabId: number,
  requestId: string,
  patch: (entry: NetworkEntry) => Partial<NetworkEntry>,
): void {
  requestLog.update(
    tabId,
    (entry) => entry.requestId === requestId,
    (entry) => Object.assign(entry, patch(entry)),
  );
}

/** Register the webRequest listeners; call once from the background entry. */
export function startNetworkStore(): void {
  const filter = { urls: ["<all_urls>"] };
  browser.webRequest.onBeforeRequest.addListener(onBeforeRequest, filter, ["blocking"]);
  browser.webRequest.onCompleted.addListener((details) => {
    updateEntry(details.tabId, details.requestId, (entry) => ({
      status: details.statusCode,
      durationMs: Math.round(details.timeStamp - entry.startedAt),
    }));
  }, filter);
  browser.webRequest.onErrorOccurred.addListener(
    (details) => updateEntry(details.tabId, details.requestId, () => ({ error: details.error })),
    filter,
  );
  browser.tabs.onRemoved.addListener((tabId) => {
    requestLog.clear(tabId);
    forgetDrivenTab(tabId);
  });
}

export function formatNetworkEntry(entry: NetworkEntry): string {
  const outcome = entry.error ? `ERROR ${entry.error}` : String(entry.status ?? "pending");
  const body = entry.hasBody ? " [body]" : "";
  return `${entry.requestId} ${entry.method} ${outcome} ${entry.type} ${entry.url}${body}`;
}

/** read_network_requests: the tab's request list, or one stored body when query.requestId is set. */
export async function readNetwork(query: NetworkQuery): Promise<string> {
  if (query.requestId)
    return (
      bodiesByRequestId.get(query.requestId) ??
      `no body stored for request ${query.requestId}: bodies are kept for the last ${MAX_BODIES} XHR/fetch responses only`
    );
  const id = await resolveTabId(query.tabId);
  const needle = query.urlPattern?.toLowerCase();
  const entries = requestLog
    .list(id)
    .filter((entry) => !needle || entry.url.toLowerCase().includes(needle));
  const limited = entries.slice(-Math.min(Math.max(query.limit ?? 50, 1), 300));
  if (limited.length === 0) return "no requests recorded for this tab yet";
  return limited.map(formatNetworkEntry).join("\n");
}
