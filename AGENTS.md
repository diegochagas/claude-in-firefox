# AGENTS.md — claude-in-firefox

Firefox WebExtension + native-messaging host + MCP server that gives Claude Code the same
browser tools as the official "Claude in Chrome" extension, written from scratch (no Anthropic
code or assets). Three programs, one TypeScript repo, bundled by esbuild into `dist/`.

## Layout

- `extension/src/background/` — tabs, screenshots, console/network stores, native port, command router
- `extension/src/content/` — runs inside pages: outline/refs, pointer, keyboard, scroll, forms, eval, console hook
- `extension/src/shared/` — wire types (`protocol.ts`) and key-name table used by all three programs
- `native-host/src/` — stdio framing ⇄ Unix socket (JSON lines), multiplexes several MCP servers
- `mcp-server/src/` — MCP tools (`tools/*.ts`), `BridgeClient`, `ToolRegistry` (the only file that touches the MCP SDK)
- `tests/` (vitest unit, jsdom for content modules, `FakeBridge` for tools), `e2e/` (real headless Firefox via web-ext)
- `scripts/check` gate, `scripts/setup` bootstrap, `scripts/e2e` end-to-end run,
  `scripts/release <version>` (sign with AMO + GitHub Release with xpi and updates.json; `--dry-run` publishes nothing)

## Testing and shipping (dev-playbook)

This repo follows the dev-playbook (`~/.claude/skills/dev-playbook/PLAYBOOK.md`).

- One gate: `scripts/check` (prettier + tsc + eslint + vitest + build + clean-code audit). The pre-push hook runs it
  (`git config core.hooksPath .githooks`). Never push with `--no-verify`.
- `scripts/e2e` drives a real headless Firefox (extension + native host + MCP server) and writes
  `e2e/screenshots/*.png`; run it for any change in `extension/` and attach the screenshots.
- Bugs: write a failing regression test first, then fix.
- Never weaken, skip or delete a test to make it pass.
- Risk class for this repo: **none** (reads/drives the user's browser; no money, DB or deletion). The native
  host and `javascript_tool` run arbitrary page code on request, so never widen what the socket accepts
  beyond `BridgeMethod`, and keep `redactUrl` on everything the model sees.
- External services: none. Tests never need network beyond the local fixture server.
- No real paths, IPs, passwords or tokens in code, tests, fixtures or docs. `scripts/setup` derives paths at install time.
- Before finishing: run `/code-review` on the diff, then give the evidence package:
  summary, risk class, test results, screenshots, rollback steps.

## Clean code (dev-playbook CLEAN-CODE.md)

Language: TypeScript (strict, ESM) for all three programs; bash only in `scripts/`.
Formatter: prettier; `scripts/check` runs it, don't discuss style.

- Functions 4–20 lines (eslint `max-lines-per-function`, strict 20: no React here). Files ≤300 lines
  (`scripts/clean-code-audit --strict --max-file-lines 300` in `scripts/check`), hard max 500 (eslint).
- One responsibility per module: one content command per file, one tool group per `mcp-server/src/tools/*.ts`.
- Names specific and searchable (<5 grep hits). Banned: `data`, `handler`, `utils`, `Manager`, `Service`.
- Types explicit: no `any`; everything crossing a process boundary is typed in `extension/src/shared/protocol.ts`.
- Early returns, max 2 nested levels. Extract duplicated logic the second time it appears.
- Errors include the offending value and the expected shape
  (`unknown ref "ref_9": expected a ref_N returned by read_page or find on the current page`).
- Comments: keep the ones you find. Write WHY (Firefox quirks: Xray wrappers, compartments, untrusted events), cite issues/SHAs.
  Docstring + one usage example on public functions.
- Dependencies injected: tools take a `BridgeRequester`; the MCP SDK stays behind `mcp-server/src/tool-registry.ts`;
  tests use the named `FakeBridge` (`tests/fakes/fake-bridge.ts`), not inline stubs.
- Logging: JSON lines on stderr in the native host and MCP server (stdout is the protocol channel); the extension logs JSON to its console.
- Defensive code this repo needs (implement these; flag anything else instead of adding it silently):
  per-request timeout on the bridge (60s) and page evaluation (30s); reconnect with backoff on the native port;
  content-script injection fallback for tabs opened before the extension; truncation of every page-derived text with an explicit note.
- README has an "Architecture" section (diagram of the main flow); update it when the shape changes.
- `scripts/setup` bootstraps a clean machine idempotently; `scripts/check` is the single validation command.

## Firefox facts worth remembering

- Content scripts see the page through Xray wrappers: use `window.wrappedJSObject` for page globals,
  `exportFunction` to expose functions, and never hand a content-compartment array/object to page code
  (`Reflect.apply`, not `fn.apply`).
- Synthetic events are untrusted: activation behaviour (links, buttons, checkboxes) still runs, but file
  pickers, popups and `prefers-color-scheme` emulation are out of reach (no debugger API in Firefox).
- `tabs.captureTab` works on background tabs; its `rect` is document-relative, the model's zoom region is viewport-relative.
- Native messaging frames are 4-byte little-endian length + JSON; messages to the extension max 1 MiB.
- Release Firefox only runs signed extensions permanently: `web-ext run` (temporary) or a signed xpi
  from `scripts/release` (AMO unlisted). The manifest's `update_url` points at
  `releases/latest/download/updates.json`, so every release must attach a fresh `updates.json`.
- AMO credentials live only in `config.env` (gitignored); never in the workflow files or docs.
