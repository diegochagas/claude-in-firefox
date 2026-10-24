# Claude in Firefox

A Firefox WebExtension (shown in Firefox as **Claude Browser Bridge**, since add-on names may
not contain the Firefox trademark) plus an [MCP](https://modelcontextprotocol.io) server that lets
**Claude Code** (CLI and desktop app) drive Firefox the way the official _Claude in Chrome_
extension drives Chrome: list tabs, navigate, click, type, scroll, take screenshots, read the
page as an accessibility outline, fill forms, run JavaScript, and read console and network logs.

Anthropic ships no Firefox extension (its help centre says Claude in Chrome supports only
Google Chrome). This project is an independent, clean-room implementation: it contains no
Anthropic code or assets and never touches your Claude credentials. It has two halves: the
browser-automation tools, exposed to Claude Code as `mcp__claude-in-firefox__*`, and a
**sidebar chat** that runs a local Claude Code session for you (see
[Sidebar chat](#sidebar-chat)).

## Tools

| Tool                                             | What it does                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabs_context`, `tabs_create`, `tabs_close`      | list / open / close tabs (every other tool takes an optional `tabId`)                                                                                       |
| `navigate`                                       | open a URL, or go `back` / `forward`, waiting for the load                                                                                                  |
| `computer`                                       | `screenshot`, `left_click`, `right_click`, `double_click`, `triple_click`, `hover`, `left_click_drag`, `type`, `key`, `scroll`, `scroll_to`, `zoom`, `wait` |
| `read_page`                                      | indented outline with roles, names, state and `[ref_N]` tags; `filter: interactive` for a flat list                                                         |
| `find`                                           | substring search over the outline, returns refs                                                                                                             |
| `form_input`                                     | set inputs, selects, checkboxes, contenteditable by ref                                                                                                     |
| `get_page_text`                                  | readable text, main content first                                                                                                                           |
| `javascript_tool`                                | evaluate code in the page with console semantics (top-level `await`, last expression returned)                                                              |
| `read_console_messages`, `read_network_requests` | per-tab console capture and request log, XHR/fetch bodies by `requestId`                                                                                    |
| `resize_window`                                  | mobile / tablet / desktop presets or a custom viewport                                                                                                      |
| `browser_batch`                                  | several calls in one round trip                                                                                                                             |

Coordinates are CSS pixels of the viewport and map 1:1 onto the screenshot the model just
took (`scale` shrinks the image and the note says how to convert back).

## Sidebar chat

Click the toolbar icon → **Open chat** (or press `Alt+Shift+C`) and a chat opens in the
Firefox sidebar, like Claude in Chrome's side panel: ask about the page you are on and Claude
answers, reads it, clicks, types and opens tabs through the same browser tools. Each message
carries the tab you are looking at, so Claude starts on the right page without being told.

Under the hood the native host runs **your own Claude Code** for each conversation
(`claude -p --output-format stream-json --input-format stream-json`, resumed with
`--resume` when the process is gone), so it uses your Claude Code login and plan, no API key,
and nothing goes through any server of this project. Replies stream as they arrive; tool calls
show as collapsible lines with their result, and screenshots Claude takes appear inline (kept in
memory only, so they are gone after a restart; one over ~700 KB is replaced by a note, since
native messaging frames are capped at 1 MiB).

- **Permissions.** The `claude-in-firefox` tools are pre-approved. Anything else Claude Code
  would ask about (Bash, file writes, other tools) appears in the sidebar as an
  **Allow / Deny** card; nothing runs until you answer. Your Claude Code settings and hooks apply
  as usual. Only this project's MCP server is loaded (`--strict-mcp-config`), so other MCP servers
  you registered in Claude Code are not available in the sidebar.
- **Model.** The picker sends `--model` (Sonnet, Opus, Haiku, or your default). Changing it
  mid-conversation restarts the process with `--resume`, so the history is kept.
- **History.** The last 20 conversations stay in the extension's storage and can be reopened
  from the picker; after a browser restart the next message resumes the Claude Code session.
  **New chat** starts a fresh one; **Stop** interrupts the current turn.
- **Where it runs.** Sessions live in `~/.local/state/claude-in-firefox/chat` (Claude Code's
  working directory, so no project's `CLAUDE.md` leaks in; `claude --resume` works from there).
  The host finds `claude` on `PATH`, then in `~/.local/bin` and `~/.claude/local`; set
  `CLAUDE_IN_FIREFOX_CLAUDE_BIN` if yours lives elsewhere (Firefox started from a desktop launcher
  may have a shorter `PATH` than your terminal).
- **From Claude Code.** The bridge also accepts `chat.send` and `chat.transcript`, so a script
  or test can post a turn into the sidebar and read what happened (the e2e suite does this with
  a fake `claude`).

## From the Claude desktop app

Claude Code sessions (CLI and the desktop app's **Code** tab) see the tools as soon as
`scripts/setup` has registered the server. The desktop app's **Chat** tab (claude.ai) does not
read Claude Code's MCP servers; it has its own list in `claude_desktop_config.json`
(`~/.config/Claude/` on Linux). Add the server there with absolute paths, since the app launches
MCP servers with a minimal environment and no `PATH`:

```json
{
  "mcpServers": {
    "claude-in-firefox": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/claude-in-firefox/dist/mcp-server.js"]
    }
  }
}
```

Restart the app; a Chat conversation then lists `claude-in-firefox` among its tools and can
drive Firefox the way Claude in Chrome drives Chrome. A Chat conversation has no "current tab",
so name the tab you mean or let it open one with `tabs_create`.

## Architecture

```
Claude Code / desktop app
   │  MCP over stdio
   ▼
dist/mcp-server.js  ── JSON lines over a Unix socket ──▶  dist/native-host.js
(one per Claude session)       /run/user/<uid>/claude-in-firefox.sock   (spawned by Firefox,
        ▲                                                                  one per extension)
        │ MCP over stdio (sidebar chat)                      claude -p ◀────┤ stdin/stdout stream-json,
        └──────────────────────────────────────────────────  per conversation │ one process per chat
                                                                              │ native messaging
                                                                              │ (4-byte length + JSON)
                                                                              ▼
                                                                  extension background.js
                                                                  tabs · screenshots · console/network stores
                                                                  chat store ──▶ sidebar.html (runtime Port)
                                                                              │ tabs.sendMessage
                                                                              ▼
                                                                  content.js in each page
                                                                  outline/refs · pointer · keyboard · forms · eval
```

The native host multiplexes any number of MCP servers onto the single extension connection,
so several Claude Code sessions can share one Firefox. For the sidebar it also spawns one
`claude` process per conversation; that process starts its own `mcp-server.js`, which connects
back to the same socket. Bridge wire types live in `extension/src/shared/protocol.ts`, chat
types in `extension/src/shared/chat-protocol.ts`.

## Install

Requirements: Firefox 128+, Node.js 22+, Claude Code.

```bash
git clone https://github.com/diegochagas/claude-in-firefox
cd claude-in-firefox
./scripts/setup
```

`scripts/setup` installs dependencies, builds `dist/`, writes the native-messaging manifest
to `~/.mozilla/native-messaging-hosts/claude_in_firefox.json` (pointing at this checkout) and
registers the MCP server in Claude Code (user scope) as `claude-in-firefox`. Re-running it is
safe. Pass `--no-mcp` to skip the Claude Code registration.

Then install the extension in Firefox, one of:

- **Signed release (recommended):** download the latest `.xpi` from
  [Releases](https://github.com/diegochagas/claude-in-firefox/releases/latest) and open it in
  Firefox (`about:addons` → gear → _Install Add-on From File_, or drag it onto a window). It is
  signed by Mozilla through the unlisted channel, so it stays installed, and the manifest's
  `update_url` points at the release's `updates.json`, so Firefox pulls newer versions by itself.
- **Try it now (temporary):** `npm run firefox` opens your default profile with the extension
  loaded until Firefox quits, or use `about:debugging#/runtime/this-firefox` →
  _Load Temporary Add-on_ → `dist/extension/manifest.json`.

The toolbar badge reads **on** when the native host is connected; clicking the icon opens a
status popup (connection state, tabs Claude has driven, Reconnect, **Open chat**). A new
Claude Code session then lists the `claude-in-firefox` tools; pick a tab with `tabs_context`
and go, or open the sidebar chat and type.

## Development

```bash
npm run watch        # rebuild dist/ on change
./scripts/check      # prettier + tsc + eslint + vitest + build + clean-code audit (the pre-push gate)
./scripts/e2e        # real headless Firefox through web-ext; screenshots in e2e/screenshots/
```

Unit tests run the content-script modules under jsdom and the MCP tools against a
`FakeBridge`; the native host's `claude` runner is tested against `tests/fakes/fake-claude.mjs`,
a stand-in that speaks the stream-json subset the host relies on. The e2e suite starts a local
fixture server, launches Firefox headless with the built extension, waits for the native host's
socket (isolated via `CLAUDE_IN_FIREFOX_SOCKET`), calls every tool through an in-memory MCP
client, and sends a sidebar-chat turn through the fake `claude`
(`CLAUDE_IN_FIREFOX_CLAUDE_BIN`), screenshotting the sidebar page.

## Releasing

```bash
./scripts/release 0.2.0 --dry-run   # build + lint, publishes nothing
./scripts/release 0.2.0             # bump, sign with AMO, publish xpi + updates.json
```

`scripts/release` needs addons.mozilla.org API credentials in `config.env` (see
`config.env.example`; the file is gitignored). It bumps `extension/manifest.json` and
`package.json`, builds, signs `dist/extension` on the unlisted channel, regenerates
`updates.json` (previous versions kept, `sha256` hash per file via
`scripts/build-updates-json.ts`), commits and tags `v<version>`, pushes, and creates the
GitHub Release with the `.xpi` and `updates.json` attached. The `update_url` always resolves
through `releases/latest/download/updates.json`, so the newest release is what installed
copies see.

## Limitations

- Events are synthetic (`isTrusted` is false). Links, buttons, form controls and framework
  handlers work; file pickers, popups and anything needing a real user gesture do not. Firefox
  has no `chrome.debugger` equivalent for trusted input.
- Extensions cannot run on `about:`, `moz-extension:`, addons.mozilla.org or the PDF viewer.
- `prefers-color-scheme` cannot be emulated per tab; `resize_window` resizes the real window.
- `javascript_tool` evaluates in the page's world; pages whose CSP forbids `eval` fall back to
  the content-script world (DOM visible, page globals not), and the result says so.
- The sidebar chat needs Claude Code installed and logged in on this machine; it shows
  Claude Code's own error when it is not. Stopping a turn asks Claude Code to interrupt and
  kills the process after 5 s if it does not; the conversation resumes on the next message.

## License

MIT
