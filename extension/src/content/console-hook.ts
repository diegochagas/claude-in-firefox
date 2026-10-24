// Captures the page's console output and uncaught errors for read_console_messages. The page's
// console methods are replaced with exported wrappers that forward a copy to the background
// and then call the original, so DevTools still shows everything.
import type { ConsoleBatchMessage, ConsoleEntry } from "../shared/protocol";

const LEVELS: ConsoleEntry["level"][] = ["log", "info", "warn", "error", "debug"];
const FLUSH_INTERVAL_MS = 250;
const MAX_TEXT_CHARS = 2000;

let pending: ConsoleEntry[] = [];
let flushTimer: number | undefined;

function formatArgument(argument: unknown): string {
  if (typeof argument === "string") return argument;
  if (argument instanceof Error) return `${argument.name}: ${argument.message}`;
  try {
    return JSON.stringify(argument) ?? String(argument);
  } catch {
    return String(argument);
  }
}

function queue(level: ConsoleEntry["level"], text: string): void {
  pending.push({
    level,
    text: text.slice(0, MAX_TEXT_CHARS),
    url: location.href,
    timestamp: Date.now(),
  });
  if (flushTimer === undefined) flushTimer = window.setTimeout(flush, FLUSH_INTERVAL_MS);
}

function flush(): void {
  flushTimer = undefined;
  if (pending.length === 0) return;
  const message: ConsoleBatchMessage = { kind: "consoleBatch", entries: pending };
  pending = [];
  browser.runtime.sendMessage(message).catch(() => undefined);
}

function wrapConsoleMethod(level: ConsoleEntry["level"]): void {
  const pageConsole = window.wrappedJSObject.console as Record<
    string,
    (...args: unknown[]) => void
  >;
  const original = pageConsole[level];
  if (typeof original !== "function") return;
  const wrapper = function (this: unknown, ...args: unknown[]): void {
    queue(level, args.map(formatArgument).join(" "));
    // Reflect.apply runs in this compartment: the page's own Function.prototype.apply would be
    // denied access to `args` (a content-script array) and throw "Permission denied".
    Reflect.apply(original, this, args);
  };
  exportFunction(wrapper, pageConsole, { defineAs: level });
}

function hookErrors(): void {
  window.addEventListener("error", (event) => {
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    queue("error", `Uncaught ${event.message}${where}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    queue("error", `Unhandled promise rejection: ${formatArgument(event.reason)}`);
  });
}

/** Install the console and error hooks once per document. */
export function installConsoleHook(): void {
  try {
    LEVELS.forEach(wrapConsoleMethod);
  } catch (error) {
    // Some privileged or sandboxed documents refuse exportFunction; errors are still captured.
    queue("warn", `Claude in Firefox could not hook console: ${String(error)}`);
  }
  hookErrors();
}
