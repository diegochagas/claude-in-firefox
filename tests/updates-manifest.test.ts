import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addRelease, EXTENSION_ID, sha256OfFile } from "../scripts/build-updates-json";

const entry = (version: string) => ({
  version,
  update_link: `https://example.test/v${version}/claude_in_firefox-${version}.xpi`,
  update_hash: "sha256:abc",
});

describe("updates.json builder", () => {
  it("starts a manifest from nothing", () => {
    expect(addRelease(undefined, entry("0.1.0"))).toEqual({
      addons: { [EXTENSION_ID]: { updates: [entry("0.1.0")] } },
    });
  });
  it("keeps older versions and replaces a re-released one", () => {
    const first = addRelease(undefined, entry("0.1.0"));
    const second = addRelease(first, entry("0.2.0"));
    const again = addRelease(second, { ...entry("0.2.0"), update_hash: "sha256:new" });
    expect(again.addons[EXTENSION_ID]!.updates.map((u) => [u.version, u.update_hash])).toEqual([
      ["0.1.0", "sha256:abc"],
      ["0.2.0", "sha256:new"],
    ]);
  });
  it("hashes the xpi with the sha256: prefix Firefox expects", () => {
    const file = join(mkdtempSync(join(tmpdir(), "xpi-")), "a.xpi");
    writeFileSync(file, "hello");
    expect(sha256OfFile(file)).toBe(
      "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});
