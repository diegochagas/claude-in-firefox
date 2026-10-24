import { describe, expect, it } from "vitest";
import {
  TOOL_RESULT_MAX_CHARS,
  toolResultText,
  translateClaudeLine,
} from "../native-host/src/claude-stream";

const line = (message: unknown) => JSON.stringify(message);

describe("translateClaudeLine", () => {
  it("maps init to a session event", () => {
    expect(
      translateClaudeLine(line({ type: "system", subtype: "init", session_id: "s1", model: "m" })),
    ).toEqual([{ type: "session", sessionId: "s1", model: "m" }]);
    expect(translateClaudeLine(line({ type: "system", subtype: "status" }))).toEqual([]);
  });
  it("streams text deltas and ignores other stream events", () => {
    expect(
      translateClaudeLine(
        line({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
        }),
      ),
    ).toEqual([{ type: "text", delta: "Hi" }]);
    expect(
      translateClaudeLine(
        line({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "input_json_delta" } },
        }),
      ),
    ).toEqual([]);
  });
  it("maps assistant content blocks to final text and tool calls", () => {
    expect(
      translateClaudeLine(
        line({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Done." },
              {
                type: "tool_use",
                id: "t1",
                name: "mcp__claude-in-firefox__find",
                input: { query: "x" },
              },
            ],
          },
        }),
      ),
    ).toEqual([
      { type: "assistant_text", text: "Done." },
      {
        type: "tool_use",
        toolUseId: "t1",
        name: "mcp__claude-in-firefox__find",
        input: { query: "x" },
      },
    ]);
  });
  it("maps tool results (string or blocks) and truncates long ones with a note", () => {
    const long = "x".repeat(TOOL_RESULT_MAX_CHARS + 50);
    expect(
      translateClaudeLine(
        line({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "t1", content: "ok", is_error: false },
              {
                type: "tool_result",
                tool_use_id: "t2",
                content: [{ type: "text", text: long }, { type: "image" }],
                is_error: true,
              },
            ],
          },
        }),
      ),
    ).toMatchObject([
      { type: "tool_result", toolUseId: "t1", text: "ok", isError: false },
      { type: "tool_result", toolUseId: "t2", isError: true },
    ]);
    expect(toolResultText(long)).toMatch(/…\s\[truncated, 650 chars\]$/);
    expect(toolResultText([{ type: "image" }])).toBe("[image]");
  });
  it("maps permission prompts and results", () => {
    expect(
      translateClaudeLine(
        line({
          type: "control_request",
          request_id: "req-1",
          request: {
            subtype: "can_use_tool",
            tool_name: "Bash",
            input: { command: "ls" },
            description: "List",
          },
        }),
      ),
    ).toEqual([
      {
        type: "permission",
        requestId: "req-1",
        toolName: "Bash",
        input: { command: "ls" },
        description: "List",
      },
    ]);
    expect(
      translateClaudeLine(
        line({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Bye",
          duration_ms: 5,
          total_cost_usd: 0.1,
        }),
      ),
    ).toEqual([
      { type: "turn_end", isError: false, resultText: "Bye", durationMs: 5, costUsd: 0.1 },
    ]);
    expect(translateClaudeLine(line({ type: "result", subtype: "error_max_turns" }))).toMatchObject(
      [{ type: "turn_end", isError: true, resultText: "error_max_turns" }],
    );
  });
  it("yields nothing for junk, unknown types and interrupt requests", () => {
    expect(translateClaudeLine("not json")).toEqual([]);
    expect(translateClaudeLine(line({ type: "rate_limit_event" }))).toEqual([]);
    expect(
      translateClaudeLine(
        line({ type: "control_request", request_id: "i", request: { subtype: "interrupt" } }),
      ),
    ).toEqual([]);
    expect(translateClaudeLine("null")).toEqual([]);
  });
});
