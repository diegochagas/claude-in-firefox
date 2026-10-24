import { userInfo } from "node:os";

/**
 * Where the native host listens and the MCP server connects. Override with
 * CLAUDE_IN_FIREFOX_SOCKET (tests use a temp dir).
 *
 * Example: bridgeSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" }) → "/run/user/1000/claude-in-firefox.sock"
 */
export function bridgeSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CLAUDE_IN_FIREFOX_SOCKET) return env.CLAUDE_IN_FIREFOX_SOCKET;
  if (env.XDG_RUNTIME_DIR) return `${env.XDG_RUNTIME_DIR}/claude-in-firefox.sock`;
  return `/tmp/claude-in-firefox-${userInfo().uid}.sock`;
}
