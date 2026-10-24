import { describe, expect, it } from "vitest";
import {
  filterConsoleEntries,
  formatConsoleEntry,
} from "../extension/src/background/console-store";
import { formatNetworkEntry } from "../extension/src/background/network-store";
import { redactUrl } from "../extension/src/background/redact-url";
import { PerTabRingBuffer } from "../extension/src/background/ring-buffer";
import { normalizeUrl } from "../extension/src/background/tab-commands";
import type { ConsoleEntry } from "../extension/src/shared/protocol";

describe("redactUrl", () => {
  it("hides credential-looking query values and keeps the rest", () => {
    expect(redactUrl("https://x.test/a?api_key=123&page=2&access_token=abc#frag")).toBe(
      "https://x.test/a?api_key=REDACTED&page=2&access_token=REDACTED#frag",
    );
    expect(redactUrl("https://x.test/plain")).toBe("https://x.test/plain");
  });
});

describe("normalizeUrl", () => {
  it("adds https to bare hosts and http to localhost", () => {
    expect(normalizeUrl("example.com/path")).toBe("https://example.com/path");
    expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeUrl("about:blank")).toBe("about:blank");
    expect(normalizeUrl(" https://a.b ")).toBe("https://a.b");
  });
});

describe("PerTabRingBuffer", () => {
  it("keeps the newest entries per tab and forgets closed tabs", () => {
    const buffer = new PerTabRingBuffer<number>(2);
    [1, 2, 3].forEach((n) => buffer.push(7, n));
    buffer.push(8, 9);
    expect(buffer.list(7)).toEqual([2, 3]);
    buffer.clear(7);
    expect(buffer.list(7)).toEqual([]);
    expect(buffer.list(8)).toEqual([9]);
  });
});

describe("console filtering", () => {
  const entries: ConsoleEntry[] = [
    { level: "log", text: "loaded users", url: "u", timestamp: 0 },
    { level: "error", text: "TypeError: boom", url: "u", timestamp: 1000 },
    { level: "warn", text: "slow users query", url: "u", timestamp: 2000 },
  ];
  it("applies onlyErrors, pattern and limit (newest last)", () => {
    expect(filterConsoleEntries(entries, { onlyErrors: true }).map((e) => e.text)).toEqual([
      "TypeError: boom",
    ]);
    expect(filterConsoleEntries(entries, { pattern: "USERS" }).length).toBe(2);
    expect(filterConsoleEntries(entries, { limit: 1 })[0]?.level).toBe("warn");
  });
  it("formats with a time and level prefix", () => {
    expect(formatConsoleEntry(entries[1]!)).toBe("[00:00:01.000] ERROR TypeError: boom");
  });
});

describe("formatNetworkEntry", () => {
  it("shows status, errors and body availability", () => {
    expect(
      formatNetworkEntry({
        requestId: "5",
        method: "GET",
        url: "https://a/b",
        type: "xmlhttprequest",
        status: 200,
        startedAt: 0,
        hasBody: true,
      }),
    ).toBe("5 GET 200 xmlhttprequest https://a/b [body]");
    expect(
      formatNetworkEntry({
        requestId: "6",
        method: "POST",
        url: "https://a/c",
        type: "main_frame",
        error: "NS_ERROR_NET",
        startedAt: 0,
        hasBody: false,
      }),
    ).toBe("6 POST ERROR NS_ERROR_NET main_frame https://a/c");
  });
});
