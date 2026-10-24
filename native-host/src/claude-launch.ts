// How the host starts `claude` for a sidebar conversation: binary lookup, working directory,
// and the argument list (stream-json both ways, permission prompts over stdio, only the
// claude-in-firefox MCP server, its tools pre-approved).
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export const CHAT_SYSTEM_PROMPT =
  "You are answering from the sidebar of the user's Firefox. The claude-in-firefox tools drive that same browser; every user message starts with the tab they are looking at, so use its tabId directly instead of asking which tab. Read the page with get_page_text or read_page before answering questions about it. The sidebar is narrow: keep answers short and avoid wide tables.";

export interface ClaudeLaunchOptions {
  model?: string;
  resumeSessionId?: string;
  /** Absolute path of dist/mcp-server.js, started by claude over stdio. */
  mcpServerPath: string;
  /** Node binary that runs the MCP server (claude filters the environment, so no PATH lookup). */
  nodePath: string;
  /** Propagated so the MCP server reaches this host's socket in an isolated run (e2e). */
  socketPath?: string;
}

function mcpConfig(options: ClaudeLaunchOptions): string {
  const env = options.socketPath ? { CLAUDE_IN_FIREFOX_SOCKET: options.socketPath } : {};
  return JSON.stringify({
    mcpServers: {
      "claude-in-firefox": { command: options.nodePath, args: [options.mcpServerPath], env },
    },
  });
}

/**
 * Argument list for one conversation's `claude` process.
 * Example: buildClaudeArgs({ model: "sonnet", mcpServerPath: "/x/mcp-server.js", nodePath: "/usr/bin/node" })
 */
export function buildClaudeArgs(options: ClaudeLaunchOptions): string[] {
  const args = [
    "-p",
    "--output-format=stream-json",
    "--input-format=stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-prompt-tool=stdio",
    "--strict-mcp-config",
    `--mcp-config=${mcpConfig(options)}`,
    "--allowedTools=mcp__claude-in-firefox",
    `--append-system-prompt=${CHAT_SYSTEM_PROMPT}`,
  ];
  if (options.model) args.push(`--model=${options.model}`);
  if (options.resumeSessionId) args.push(`--resume=${options.resumeSessionId}`);
  return args;
}

/**
 * The `claude` executable: CLAUDE_IN_FIREFOX_CLAUDE_BIN, else the first match on PATH, else
 * the places the installers use. Firefox started from a desktop launcher may have a shorter
 * PATH than a terminal, hence the fallbacks. Returns "claude" (and lets spawn fail with
 * ENOENT) when nothing is found.
 */
export function resolveClaudeBinary(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  home: string = homedir(),
): string {
  if (env.CLAUDE_IN_FIREFOX_CLAUDE_BIN) return env.CLAUDE_IN_FIREFOX_CLAUDE_BIN;
  const onPath = (env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, "claude"))
    .find(exists);
  if (onPath) return onPath;
  const fallbacks = [join(home, ".local/bin/claude"), join(home, ".claude/local/claude")];
  return fallbacks.find(exists) ?? "claude";
}

/**
 * Working directory for chat sessions: a dedicated state folder, so no project's CLAUDE.md
 * leaks into the sidebar and `--resume` finds the sessions again.
 * Example: chatWorkingDirectory({}, "/home/u") → "/home/u/.local/state/claude-in-firefox/chat"
 */
export function chatWorkingDirectory(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const stateHome = env.XDG_STATE_HOME || join(home, ".local/state");
  return join(stateHome, "claude-in-firefox", "chat");
}

/** Create the chat working directory if needed and return it. */
export function ensureChatWorkingDirectory(): string {
  const dir = chatWorkingDirectory();
  mkdirSync(dir, { recursive: true });
  return dir;
}
