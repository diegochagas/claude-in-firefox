import type { ConsoleBatchMessage, ConsoleEntry } from "../shared/protocol";
import { resolveTabId } from "./active-tab";
import { PerTabRingBuffer } from "./ring-buffer";

const consoleLog = new PerTabRingBuffer<ConsoleEntry>(500);

interface ConsoleQuery {
  tabId?: unknown;
  limit?: number;
  onlyErrors?: boolean;
  pattern?: string;
}

function isConsoleBatch(message: unknown): message is ConsoleBatchMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as ConsoleBatchMessage).kind === "consoleBatch"
  );
}

/** Store console batches sent by content scripts; call once from the background entry. */
export function startConsoleStore(): void {
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isConsoleBatch(message) || sender.tab?.id === undefined) return undefined;
    for (const entry of message.entries) consoleLog.push(sender.tab.id, entry);
    return undefined;
  });
  browser.tabs.onRemoved.addListener((tabId) => consoleLog.clear(tabId));
}

export function filterConsoleEntries(entries: ConsoleEntry[], query: ConsoleQuery): ConsoleEntry[] {
  const needle = query.pattern?.toLowerCase();
  const filtered = entries.filter((entry) => {
    if (query.onlyErrors && entry.level !== "error") return false;
    return !needle || entry.text.toLowerCase().includes(needle);
  });
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  return filtered.slice(-limit);
}

export function formatConsoleEntry(entry: ConsoleEntry): string {
  return `[${new Date(entry.timestamp).toISOString().slice(11, 23)}] ${entry.level.toUpperCase()} ${entry.text}`;
}

/** read_console_messages: filtered, newest-last console lines of the tab. */
export async function readConsole(query: ConsoleQuery): Promise<string> {
  const id = await resolveTabId(query.tabId);
  const entries = filterConsoleEntries(consoleLog.list(id), query);
  if (entries.length === 0)
    return "no console messages captured for this tab (capture starts when the page loads with the extension active)";
  return entries.map(formatConsoleEntry).join("\n");
}
