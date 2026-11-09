import { existsSync } from "node:fs";
import { userInfo } from "node:os";

/**
 * Where the native host listens and the MCP server connects. Derived from the user id, not
 * from XDG_RUNTIME_DIR: MCP clients (Claude Code, the SDK's stdio transport) spawn the server
 * with a filtered environment, while Firefox spawns the host with the full session one, and
 * both must agree (found by the live smoke test, 2026-10-24). CLAUDE_IN_FIREFOX_SOCKET
 * overrides it (the e2e harness isolates its run that way).
 *
 * On Windows there are no Unix socket paths, so it is a per-user named pipe instead. The user
 * name comes from the OS account (not USERNAME), since the MCP client filters the environment.
 *
 * Example: bridgeSocketPath({}, 1000) → "/run/user/1000/claude-in-firefox.sock"
 * Example: bridgeSocketPath({}, -1, existsSync, { platform: "win32", userName: () => "ann" })
 *          → "\\.\pipe\claude-in-firefox-ann"
 */
export function bridgeSocketPath(
  env: NodeJS.ProcessEnv = process.env,
  uid: number = userInfo().uid,
  runtimeDirExists: (dir: string) => boolean = existsSync,
  host: HostInfo = currentHost,
): string {
  if (env.CLAUDE_IN_FIREFOX_SOCKET) return env.CLAUDE_IN_FIREFOX_SOCKET;
  if (host.platform === "win32") return windowsPipePath(host.userName());
  const runtimeDir = `/run/user/${uid}`;
  if (runtimeDirExists(runtimeDir)) return `${runtimeDir}/claude-in-firefox.sock`;
  return `/tmp/claude-in-firefox-${uid}.sock`;
}

export interface HostInfo {
  platform: NodeJS.Platform;
  userName: () => string;
}

const currentHost: HostInfo = {
  platform: process.platform,
  userName: () => userInfo().username,
};

/** Named pipe for one Windows user; characters a pipe name cannot hold become "_". */
function windowsPipePath(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_") || "user";
  return `\\\\.\\pipe\\claude-in-firefox-${safe}`;
}
