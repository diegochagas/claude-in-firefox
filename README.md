# Claude in Firefox

A Firefox WebExtension plus an [MCP](https://modelcontextprotocol.io) server that lets
**Claude Code** (CLI and desktop app) drive Firefox the way the official _Claude in Chrome_
extension drives Chrome: list tabs, navigate, click, type, scroll, take screenshots, read the
page as an accessibility outline, fill forms, run JavaScript, and read console and network logs.

Anthropic ships no Firefox extension (its help centre says Claude in Chrome supports only
Google Chrome). This project is an independent, clean-room implementation: it contains no
Anthropic code or assets and never touches your Claude credentials. It is **not** the
claude.ai side panel chat; it is the browser-automation half, exposed to Claude Code as
tools named `mcp__claude-in-firefox__*`.

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

## Architecture

```
Claude Code / desktop app
   │  MCP over stdio
   ▼
dist/mcp-server.js  ── JSON lines over a Unix socket ──▶  dist/native-host.js
(one per Claude session)       $XDG_RUNTIME_DIR/claude-in-firefox.sock   (spawned by Firefox,
                                                                           one per extension)
                                                                              │ native messaging
                                                                              │ (4-byte length + JSON)
                                                                              ▼
                                                                  extension background.js
                                                                  tabs · screenshots · console/network stores
                                                                              │ tabs.sendMessage
                                                                              ▼
                                                                  content.js in each page
                                                                  outline/refs · pointer · keyboard · forms · eval
```

The native host multiplexes any number of MCP servers onto the single extension connection,
so several Claude Code sessions can share one Firefox. All wire types live in
`extension/src/shared/protocol.ts`.

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

Then load the extension in Firefox:

- **Try it now (temporary):** `npm run firefox` opens your default profile with the
  extension loaded until Firefox quits, or use `about:debugging#/runtime/this-firefox` →
  _Load Temporary Add-on_ → `dist/extension/manifest.json`.
- **Keep it (signed):** release Firefox only keeps signed add-ons. Create API credentials at
  addons.mozilla.org, then `WEB_EXT_API_KEY=… WEB_EXT_API_SECRET=… npm run sign` produces a
  signed `.xpi` under `web-ext-artifacts/` (unlisted channel: private to you). Install it
  from `about:addons` → gear → _Install Add-on From File_. Rebuild and re-sign with a bumped
  version in `extension/manifest.json` after changes.

The toolbar badge reads **on** when the native host is connected. A new Claude Code session
then lists the `claude-in-firefox` tools; pick a tab with `tabs_context` and go.

## Development

```bash
npm run watch        # rebuild dist/ on change
./scripts/check      # prettier + tsc + eslint + vitest + build + clean-code audit (the pre-push gate)
./scripts/e2e        # real headless Firefox through web-ext; screenshots in e2e/screenshots/
```

Unit tests run the content-script modules under jsdom and the MCP tools against a
`FakeBridge`. The e2e suite starts a local fixture server, launches Firefox headless with the
built extension, waits for the native host's socket (isolated via `CLAUDE_IN_FIREFOX_SOCKET`)
and calls every tool through an in-memory MCP client.

## Limitations

- Events are synthetic (`isTrusted` is false). Links, buttons, form controls and framework
  handlers work; file pickers, popups and anything needing a real user gesture do not. Firefox
  has no `chrome.debugger` equivalent for trusted input.
- Extensions cannot run on `about:`, `moz-extension:`, addons.mozilla.org or the PDF viewer.
- `prefers-color-scheme` cannot be emulated per tab; `resize_window` resizes the real window.
- `javascript_tool` evaluates in the page's world; pages whose CSP forbids `eval` fall back to
  the content-script world (DOM visible, page globals not), and the result says so.

## License

MIT
