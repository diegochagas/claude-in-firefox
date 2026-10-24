#!/usr/bin/env node
// Writes the Firefox update manifest (updates.json) for a signed .xpi, keeping the entries of
// the previous manifest so older versions stay listed. Run by scripts/release with Node's
// built-in TypeScript stripping (Node ≥ 22.18).
//
//   node scripts/build-updates-json.ts <version> <xpi path> <download url> [previous updates.json] > updates.json
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const EXTENSION_ID = "claude-in-firefox@diegochagas.dev";

export interface UpdateEntry {
  version: string;
  update_link: string;
  update_hash: string;
}

export interface UpdatesManifest {
  addons: Record<string, { updates: UpdateEntry[] }>;
}

/**
 * Merge one release into an updates manifest, replacing an entry of the same version.
 *
 * Example: addRelease(undefined, { version: "0.1.0", update_link: "https://…/a.xpi", update_hash: "sha256:…" })
 *   → { addons: { "claude-in-firefox@diegochagas.dev": { updates: [entry] } } }
 */
export function addRelease(
  previous: UpdatesManifest | undefined,
  entry: UpdateEntry,
): UpdatesManifest {
  const kept = (previous?.addons[EXTENSION_ID]?.updates ?? []).filter(
    (old) => old.version !== entry.version,
  );
  return { addons: { [EXTENSION_ID]: { updates: [...kept, entry] } } };
}

export function sha256OfFile(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function main(argv: string[]): void {
  const [version, xpiPath, downloadUrl, previousPath] = argv;
  if (!version || !xpiPath || !downloadUrl) {
    throw new Error(
      `usage: build-updates-json.ts <version> <xpi path> <download url> [previous updates.json]; got ${JSON.stringify(argv)}`,
    );
  }
  const previous = previousPath
    ? (JSON.parse(readFileSync(previousPath, "utf8")) as UpdatesManifest)
    : undefined;
  const manifest = addRelease(previous, {
    version,
    update_link: downloadUrl,
    update_hash: sha256OfFile(xpiPath),
  });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1]?.endsWith("build-updates-json.ts")) main(process.argv.slice(2));
