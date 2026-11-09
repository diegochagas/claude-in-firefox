import { describe, expect, it } from "vitest";
import {
  buildClaudeArgs,
  CHAT_SYSTEM_PROMPT,
  chatWorkingDirectory,
  resolveClaudeBinary,
} from "../native-host/src/claude-launch";

describe("buildClaudeArgs", () => {
  it("streams json both ways, prompts over stdio, loads only our MCP server and pre-approves it", () => {
    const args = buildClaudeArgs({ mcpServerPath: "/x/mcp-server.js", nodePath: "/n/node" });
    expect(args).toContain("--output-format=stream-json");
    expect(args).toContain("--input-format=stream-json");
    expect(args).toContain("--permission-prompt-tool=stdio");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--allowedTools=mcp__claude-in-firefox");
    expect(args).toContain(`--append-system-prompt=${CHAT_SYSTEM_PROMPT}`);
    const config = JSON.parse(args.find((a) => a.startsWith("--mcp-config="))!.slice(13));
    expect(config.mcpServers["claude-in-firefox"]).toEqual({
      command: "/n/node",
      args: ["/x/mcp-server.js"],
      env: {},
    });
    expect(args.some((a) => a.startsWith("--model") || a.startsWith("--resume"))).toBe(false);
  });
  it("adds model, resume and the isolated socket when given", () => {
    const args = buildClaudeArgs({
      model: "sonnet",
      resumeSessionId: "s9",
      mcpServerPath: "/x/m.js",
      nodePath: "/n",
      socketPath: "/tmp/b.sock",
    });
    expect(args).toContain("--model=sonnet");
    expect(args).toContain("--resume=s9");
    const config = JSON.parse(args.find((a) => a.startsWith("--mcp-config="))!.slice(13));
    expect(config.mcpServers["claude-in-firefox"].env).toEqual({
      CLAUDE_IN_FIREFOX_SOCKET: "/tmp/b.sock",
    });
  });
});

describe("resolveClaudeBinary", () => {
  it("prefers the override, then PATH, then the installer locations, then plain claude", () => {
    const only = (path: string) => (candidate: string) => candidate === path;
    expect(
      resolveClaudeBinary(
        { CLAUDE_IN_FIREFOX_CLAUDE_BIN: "/f/claude" },
        () => false,
        "/h",
        "linux",
      ),
    ).toBe("/f/claude");
    expect(resolveClaudeBinary({ PATH: "/a:/b" }, only("/b/claude"), "/h", "linux")).toBe(
      "/b/claude",
    );
    expect(resolveClaudeBinary({ PATH: "/a" }, only("/h/.local/bin/claude"), "/h", "linux")).toBe(
      "/h/.local/bin/claude",
    );
    expect(resolveClaudeBinary({}, () => false, "/h", "linux")).toBe("claude");
  });

  it("looks for claude.exe on Windows, reading Path and the native installer folder", () => {
    const only = (path: string) => (candidate: string) => candidate === path;
    const onPath = String.raw`C:\b\claude.exe`;
    const installed = String.raw`C:\h\.local\bin\claude.exe`;
    const home = String.raw`C:\h`;
    expect(resolveClaudeBinary({ Path: String.raw`C:\a;C:\b` }, only(onPath), home, "win32")).toBe(
      onPath,
    );
    expect(resolveClaudeBinary({}, only(installed), home, "win32")).toBe(installed);
    expect(resolveClaudeBinary({}, () => false, home, "win32")).toBe("claude.exe");
  });
});

describe("chatWorkingDirectory", () => {
  it("lives under XDG_STATE_HOME or ~/.local/state", () => {
    expect(chatWorkingDirectory({ XDG_STATE_HOME: "/s" }, "/h", "linux")).toBe(
      "/s/claude-in-firefox/chat",
    );
    expect(chatWorkingDirectory({}, "/h", "linux")).toBe("/h/.local/state/claude-in-firefox/chat");
  });

  it("lives under LOCALAPPDATA on Windows", () => {
    const home = String.raw`C:\h`;
    expect(chatWorkingDirectory({ LOCALAPPDATA: String.raw`C:\L` }, home, "win32")).toBe(
      String.raw`C:\L\claude-in-firefox\chat`,
    );
    expect(chatWorkingDirectory({}, home, "win32")).toBe(
      String.raw`C:\h\AppData\Local\claude-in-firefox\chat`,
    );
  });
});
