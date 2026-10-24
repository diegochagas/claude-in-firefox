import { existsSync } from "node:fs";
import { userInfo } from "node:os";

/**
 * Where the native host listens and the MCP server connects. Derived from the user id, not
 * from XDG_RUNTIME_DIR: MCP clients (Claude Code, the SDK's stdio transport) spawn the server
 * with a filtered environment, while Firefox spawns the host with the full session one, and
 * both must agree (found by the live smoke test, 2026-10-24). CLAUDE_IN_FIREFOX_SOCKET
 * overrides it (the e2e harness isolates its run that way).
 *
 * Example: bridgeSocketPath({}, 1000) → "/run/user/1000/claude-in-firefox.sock"
 */
export function bridgeSocketPath(
  env: NodeJS.ProcessEnv = process.env,
  uid: number = userInfo().uid,
  runtimeDirExists: (dir: string) => boolean = existsSync,
): string {
  if (env.CLAUDE_IN_FIREFOX_SOCKET) return env.CLAUDE_IN_FIREFOX_SOCKET;
  const runtimeDir = `/run/user/${uid}`;
  if (runtimeDirExists(runtimeDir)) return `${runtimeDir}/claude-in-firefox.sock`;
  return `/tmp/claude-in-firefox-${uid}.sock`;
}
