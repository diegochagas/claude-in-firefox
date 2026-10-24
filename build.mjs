// Bundles the three programs with esbuild:
//   extension/src → dist/extension (background + content scripts, manifest, icons)
//   native-host/src → dist/native-host.js (started by Firefox over native messaging)
//   mcp-server/src → dist/mcp-server.js (started by Claude Code over stdio)
// `node build.mjs --watch` rebuilds on change.
import { build, context } from "esbuild";
import { cp, mkdir, writeFile, chmod } from "node:fs/promises";

const watch = process.argv.includes("--watch");

const extensionBundle = {
  entryPoints: {
    background: "extension/src/background/main.ts",
    content: "extension/src/content/main.ts",
    popup: "extension/src/popup/main.ts",
  },
  bundle: true,
  format: "iife",
  target: "firefox128",
  outdir: "dist/extension",
  sourcemap: "inline",
  logLevel: "info",
};

const nodeBundle = (entry, outfile) => ({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  banner: { js: "#!/usr/bin/env node" },
  // The MCP SDK pulls express/hono for HTTP transports we never use; keep them external
  // so the bundle stays small and their dynamic requires don't break under ESM.
  external: ["express", "hono", "@hono/node-server", "cors", "express-rate-limit"],
  logLevel: "info",
});

async function copyStaticExtensionFiles() {
  await mkdir("dist/extension/icons", { recursive: true });
  await cp("extension/manifest.json", "dist/extension/manifest.json");
  await cp("extension/popup.html", "dist/extension/popup.html");
  await cp("extension/icons", "dist/extension/icons", { recursive: true });
}

async function writeNativeHostLauncher() {
  // Firefox's native-messaging manifest needs an absolute path to an executable; a tiny
  // shell wrapper lets us keep the real program in JavaScript.
  const launcher = `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/native-host.js"\n`;
  await writeFile("dist/native-host", launcher);
  await chmod("dist/native-host", 0o755);
  await chmod("dist/native-host.js", 0o755);
  await chmod("dist/mcp-server.js", 0o755);
}

const bundles = [
  extensionBundle,
  nodeBundle("native-host/src/main.ts", "dist/native-host.js"),
  nodeBundle("mcp-server/src/main.ts", "dist/mcp-server.js"),
];

if (watch) {
  await copyStaticExtensionFiles();
  const contexts = await Promise.all(bundles.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("watching…");
} else {
  await Promise.all(bundles.map((options) => build(options)));
  await copyStaticExtensionFiles();
  await writeNativeHostLauncher();
}
