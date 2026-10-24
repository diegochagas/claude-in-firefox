// Native messaging host, spawned by Firefox when the extension connects. Bridges the
// extension (stdin/stdout, framed JSON) to MCP servers (Unix socket, JSON lines).
import { createServer, type Server, type Socket } from "node:net";
import { unlinkSync } from "node:fs";
import {
  isChatCommand,
  type ChatEvent,
  type ChatEventMessage,
} from "../../extension/src/shared/chat-protocol";
import type { BridgeRequest, BridgeResponse } from "../../extension/src/shared/protocol";
import { ChatSessionTable } from "./chat-sessions";
import { buildClaudeArgs, ensureChatWorkingDirectory, resolveClaudeBinary } from "./claude-launch";
import { ClaudeChatProcess } from "./claude-process";
import { encodeNativeMessage, NativeMessageDecoder } from "./framing";
import { LineReader } from "./line-reader";
import { PendingRequestTable } from "./request-table";
import { bridgeSocketPath } from "./socket-path";

const pending = new PendingRequestTable();
const clients = new Map<number, Socket>();
let nextClientId = 1;
const chatSessions = new ChatSessionTable(startClaudeProcess, (conversationId, event) =>
  sendToExtension({ kind: "chatEvent", conversationId, event } satisfies ChatEventMessage),
);

function log(event: string, fields: Record<string, unknown> = {}): void {
  // stdout is the native-messaging channel; structured logs go to stderr.
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`);
}

function sendToExtension(message: unknown): void {
  process.stdout.write(encodeNativeMessage(message));
}

function forwardClientLine(clientId: number, line: string): void {
  let request: BridgeRequest;
  try {
    request = JSON.parse(line) as BridgeRequest;
  } catch {
    clients
      .get(clientId)
      ?.write(
        `${JSON.stringify({ id: null, error: `invalid JSON line: ${line.slice(0, 200)}` })}\n`,
      );
    return;
  }
  const bridgeId = pending.register(clientId, String(request.id));
  sendToExtension({ ...request, id: bridgeId });
}

function deliverResponse(response: BridgeResponse): void {
  const origin = pending.take(response.id);
  if (!origin) return log("orphan-response", { id: response.id });
  const client = clients.get(origin.clientId);
  client?.write(`${JSON.stringify({ ...response, id: origin.clientRequestId })}\n`);
}

function acceptClient(socket: Socket): void {
  const clientId = nextClientId++;
  const lines = new LineReader();
  clients.set(clientId, socket);
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) =>
    lines.feed(chunk).forEach((line) => forwardClientLine(clientId, line)),
  );
  socket.on("close", () => {
    clients.delete(clientId);
    pending.dropClient(clientId);
  });
  socket.on("error", (error) => log("client-error", { clientId, error: error.message }));
}

function listen(socketPath: string): Server {
  try {
    unlinkSync(socketPath);
  } catch {
    // no stale socket to remove
  }
  const server = createServer(acceptClient);
  server.listen(socketPath, () => log("listening", { socketPath, pid: process.pid }));
  return server;
}

function startClaudeProcess(
  model: string,
  resumeSessionId: string | undefined,
  emit: (event: ChatEvent) => void,
): ClaudeChatProcess {
  // dist/mcp-server.js sits next to this bundle (dist/native-host.js).
  const mcpServerPath = new URL("./mcp-server.js", import.meta.url).pathname;
  const args = buildClaudeArgs({
    model,
    resumeSessionId,
    mcpServerPath,
    nodePath: process.execPath,
    socketPath: process.env.CLAUDE_IN_FIREFOX_SOCKET,
  });
  const binary = resolveClaudeBinary();
  log("claude-start", { binary, model, resumeSessionId });
  return new ClaudeChatProcess(
    { binary, args, cwd: ensureChatWorkingDirectory(), env: process.env, model },
    emit,
  );
}

function receiveFromExtension(message: unknown): void {
  if (isChatCommand(message)) return chatSessions.handle(message);
  deliverResponse(message as BridgeResponse);
}

function readExtension(onMessage: (message: unknown) => void, onEnd: () => void): void {
  const decoder = new NativeMessageDecoder();
  process.stdin.on("data", (chunk: Buffer) => decoder.feed(chunk).forEach(onMessage));
  process.stdin.on("end", onEnd);
}

function main(): void {
  const socketPath = bridgeSocketPath();
  const server = listen(socketPath);
  const shutdown = (reason: string) => {
    log("shutdown", { reason });
    server.close();
    for (const client of clients.values()) client.destroy();
    chatSessions.shutdown();
    process.exit(0);
  };
  readExtension(receiveFromExtension, () => shutdown("extension disconnected"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
