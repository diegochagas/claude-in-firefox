// Launches a headless Firefox with the built extension through web-ext, serves the fixture
// pages over HTTP, and waits for the native host's socket. Firefox inherits
// CLAUDE_IN_FIREFOX_SOCKET from this process, so the run never touches a real session's socket.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const FIXTURE_DIR = resolve("e2e/fixtures");
const CONTENT_TYPES: Record<string, string> = { ".html": "text/html", ".json": "application/json" };

export interface FirefoxHarness {
  baseUrl: string;
  socketPath: string;
  stop(): Promise<void>;
}

function serveFixtures(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0]!.replace("/api/", "/");
    const file = join(FIXTURE_DIR, path === "/" ? "index.html" : path);
    if (!existsSync(file)) return response.writeHead(404).end("not found");
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[file.slice(file.lastIndexOf("."))] ?? "text/plain",
    });
    response.end(readFileSync(file));
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolveServer({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function launchWebExt(socketPath: string, startUrl: string): ChildProcess {
  const args = [
    "web-ext",
    "run",
    "--source-dir",
    "dist/extension",
    "--no-reload",
    "--args=--headless",
    "--start-url",
    startUrl,
  ];
  if (process.env.FIREFOX_BIN) args.push("--firefox", process.env.FIREFOX_BIN);
  const child = spawn("npx", args, {
    env: { ...process.env, CLAUDE_IN_FIREFOX_SOCKET: socketPath },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => process.stderr.write(`[web-ext] ${chunk}`));
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[web-ext] ${chunk}`));
  return child;
}

async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) return;
    await new Promise((wake) => setTimeout(wake, 250));
  }
  throw new Error(
    `native host socket ${socketPath} did not appear within ${timeoutMs / 1000}s: is the native-messaging manifest installed (scripts/setup)?`,
  );
}

function killProcessGroup(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    if (child.pid === undefined || child.exitCode !== null) return done();
    child.once("exit", () => done());
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      done();
    }
    setTimeout(() => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
      done();
    }, 5000);
  });
}

/** Start everything; the caller stops it in afterAll. */
export async function startFirefoxHarness(): Promise<FirefoxHarness> {
  const { server, baseUrl } = await serveFixtures();
  const socketPath = join(mkdtempSync(join(tmpdir(), "claude-in-firefox-e2e-")), "bridge.sock");
  const webExt = launchWebExt(socketPath, `${baseUrl}/index.html`);
  await waitForSocket(socketPath, 90_000);
  return {
    baseUrl,
    socketPath,
    stop: async () => {
      await killProcessGroup(webExt);
      server.close();
    },
  };
}
