import { describe, expect, it } from "vitest";
import { encodeNativeMessage, NativeMessageDecoder } from "../native-host/src/framing";
import { LineReader } from "../native-host/src/line-reader";
import { PendingRequestTable } from "../native-host/src/request-table";
import { bridgeSocketPath } from "../native-host/src/socket-path";

describe("native messaging framing", () => {
  it("round-trips a message", () => {
    const encoded = encodeNativeMessage({ id: "b1", result: "ok" });
    expect(encoded.readUInt32LE(0)).toBe(encoded.length - 4);
    expect(new NativeMessageDecoder().feed(encoded)).toEqual([{ id: "b1", result: "ok" }]);
  });
  it("reassembles messages split across chunks and separates concatenated ones", () => {
    const decoder = new NativeMessageDecoder();
    const first = encodeNativeMessage({ n: 1 });
    const second = encodeNativeMessage({ n: 2, text: "héllo" });
    const all = Buffer.concat([first, second]);
    expect(decoder.feed(all.subarray(0, 3))).toEqual([]);
    expect(decoder.feed(all.subarray(3, first.length + 2))).toEqual([{ n: 1 }]);
    expect(decoder.feed(all.subarray(first.length + 2))).toEqual([{ n: 2, text: "héllo" }]);
  });
});

describe("LineReader", () => {
  it("yields complete lines only", () => {
    const reader = new LineReader();
    expect(reader.feed('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(reader.feed(":2}\n\n")).toEqual(['{"b":2}']);
  });
});

describe("PendingRequestTable", () => {
  it("maps bridge ids back to the client that asked", () => {
    const table = new PendingRequestTable();
    const idA = table.register(1, "r1");
    const idB = table.register(2, "r1");
    expect(idA).not.toBe(idB);
    expect(table.take(idB)).toEqual({ clientId: 2, clientRequestId: "r1" });
    expect(table.take(idB)).toBeUndefined();
    expect(table.take(idA)).toEqual({ clientId: 1, clientRequestId: "r1" });
  });
  it("forgets a disconnected client's requests", () => {
    const table = new PendingRequestTable();
    table.register(1, "x");
    const kept = table.register(2, "y");
    table.dropClient(1);
    expect(table.size).toBe(1);
    expect(table.take(kept)?.clientId).toBe(2);
  });
});

describe("bridgeSocketPath", () => {
  it("prefers the explicit override, then /run/user/<uid>, then /tmp, ignoring XDG_RUNTIME_DIR", () => {
    const present = () => true;
    const absent = () => false;
    expect(bridgeSocketPath({ CLAUDE_IN_FIREFOX_SOCKET: "/x/y.sock" }, 7, present)).toBe(
      "/x/y.sock",
    );
    expect(bridgeSocketPath({ XDG_RUNTIME_DIR: "/elsewhere" }, 7, present)).toBe(
      "/run/user/7/claude-in-firefox.sock",
    );
    expect(bridgeSocketPath({}, 7, absent)).toBe("/tmp/claude-in-firefox-7.sock");
  });
});
