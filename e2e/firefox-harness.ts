// Launches a headless Firefox with the built extension through web-ext, serves the fixture
// pages over HTTP, and waits for the native host's socket. Firefox inherits
// CLAUDE_IN_FIREFOX_SOCKET from this process, so the run never touches a real session's socket,
// and CLAUDE_IN_FIREFOX_CLAUDE_BIN, so the sidebar chat talks to tests/fakes/fake-claude.mjs.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const FIXTURE_DIR = resolve("e2e/fixtures");
const FAKE_CLAUDE = resolve("tests/fakes/fake-claude.mjs");
const EXTENSION_ID = "claude-in-firefox@diegochagas.dev";
// Pinned so tests can open the extension's own pages (moz-extension://<uuid>/sidebar.html).
const EXTENSION_UUID = "7d6e2b3a-5c1f-4e8a-9b2d-0f3c4a5b6c7d";
const CONTENT_TYPES: Record<string, string> = { ".html": "text/html", ".json": "application/json" };

export interface FirefoxHarness {
  baseUrl: string;
  /** moz-extension://<uuid>, the origin of the extension's own pages (popup, sidebar). */
  extensionBaseUrl: string;
  socketPath: string;
  /** JSON lines the fake claude appends (one per start and per user turn). */
  fakeClaudeLog: string;
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

function launchWebExt(socketPath: string, fakeClaudeLog: string, startUrl: string): ChildProcess {
  // web-ext copies string prefs into user.js unescaped, so the quotes must arrive escaped
  // or Firefox drops the whole line (and the UUID with it).
  const uuids = JSON.stringify({ [EXTENSION_ID]: EXTENSION_UUID }).replace(/"/g, '\\"');
  const args = [
    "web-ext",
    "run",
    "--source-dir",
    "dist/extension",
    "--no-reload",
    "--args=--headless",
    `--pref=extensions.webextensions.uuids=${uuids}`,
    "--start-url",
    startUrl,
  ];
  if (process.env.FIREFOX_BIN) args.push("--firefox", process.env.FIREFOX_BIN);
  const child = spawn("npx", args, {
    env: {
      ...process.env,
      CLAUDE_IN_FIREFOX_SOCKET: socketPath,
      CLAUDE_IN_FIREFOX_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_LOG: fakeClaudeLog,
    },
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
  const runDir = mkdtempSync(join(tmpdir(), "claude-in-firefox-e2e-"));
  const socketPath = join(runDir, "bridge.sock");
  const fakeClaudeLog = join(runDir, "fake-claude.log");
  const webExt = launchWebExt(socketPath, fakeClaudeLog, `${baseUrl}/index.html`);
  await waitForSocket(socketPath, 90_000);
  return {
    baseUrl,
    extensionBaseUrl: `moz-extension://${EXTENSION_UUID}`,
    socketPath,
    fakeClaudeLog,
    stop: async () => {
      await killProcessGroup(webExt);
      server.close();
    },
  };
}
