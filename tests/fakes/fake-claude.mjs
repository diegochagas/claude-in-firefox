#!/usr/bin/env node
// Stands in for `claude -p --input-format stream-json --output-format stream-json` in unit
// tests and the e2e run (the real binary is not on CI). Speaks the subset of the protocol the
// native host relies on; see native-host/src/claude-stream.ts for the shapes.
//   - every user turn: init, one tool_use + tool_result, two text deltas, the assistant text,
//     a result; the text is "Fake reply to: <prompt>" so callers can check what arrived
//   - a prompt containing "needs-permission" first asks a can_use_tool control_request
//   - a prompt containing "slow-please" waits 10s (an interrupt control_request ends it early)
//   - FAKE_CLAUDE_LOG (optional) gets one JSON line per start and per user turn
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const resumed = args.find((arg) => arg.startsWith("--resume="))?.slice("--resume=".length);
const model =
  args.find((arg) => arg.startsWith("--model="))?.slice("--model=".length) ?? "fake-default";
const sessionId = resumed ?? `fake-session-${process.pid}`;
let pendingPermissionPrompt;
let slowTimer;
let buffered = "";

function log(record) {
  if (process.env.FAKE_CLAUDE_LOG)
    appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(record)}\n`);
}

function out(message) {
  process.stdout.write(`${JSON.stringify({ ...message, session_id: sessionId })}\n`);
}

function result(subtype, text, isError) {
  return {
    type: "result",
    subtype,
    is_error: isError,
    result: text,
    duration_ms: 12,
    total_cost_usd: 0.001,
  };
}

function streamReply(prompt) {
  out({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_fake_1",
          name: "mcp__claude-in-firefox__tabs_context",
          input: {},
        },
      ],
    },
  });
  out({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_fake_1",
          content: 'tabId=1 window=1 [complete] "Fixture" http://fixture.test/',
          is_error: false,
        },
      ],
    },
  });
  const text = `Fake reply to: ${prompt}`;
  for (const piece of [text.slice(0, 10), text.slice(10)])
    out({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } },
    });
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
  out(result("success", text, false));
}

function answer(prompt) {
  out({ type: "system", subtype: "init", model, tools: [], mcp_servers: [] });
  if (prompt.includes("needs-permission")) {
    pendingPermissionPrompt = prompt;
    out({
      type: "control_request",
      request_id: "perm-1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "touch probe.txt" },
        description: "Create probe.txt",
      },
    });
    return;
  }
  if (prompt.includes("slow-please")) {
    slowTimer = setTimeout(() => streamReply(prompt), 10_000);
    return;
  }
  streamReply(prompt);
}

function finishPermission(response) {
  const allowed = response?.response?.behavior === "allow";
  const prompt = pendingPermissionPrompt;
  pendingPermissionPrompt = undefined;
  out({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_perm",
          content: allowed ? "(Bash completed)" : "denied by user",
          is_error: !allowed,
        },
      ],
    },
  });
  const text = `Permission ${allowed ? "granted" : "denied"} for: ${prompt}`;
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
  out(result("success", text, false));
}

function interrupt() {
  clearTimeout(slowTimer);
  out(result("error_during_execution", "Interrupted by user", true));
}

function handle(message) {
  if (message.type === "control_response") return finishPermission(message.response);
  if (message.type === "control_request" && message.request?.subtype === "interrupt")
    return interrupt();
  if (message.type !== "user") return;
  const content = message.message?.content;
  const prompt = typeof content === "string" ? content : JSON.stringify(content);
  log({ event: "user", prompt });
  answer(prompt);
}

log({ event: "start", args, cwd: process.cwd() });
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  const lines = buffered.split("\n");
  buffered = lines.pop() ?? "";
  lines.filter((line) => line.trim()).forEach((line) => handle(JSON.parse(line)));
});
process.stdin.on("end", () => process.stdout.write("", () => process.exit(0)));
