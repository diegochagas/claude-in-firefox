// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { renderPopup, USAGE_HINT } from "../extension/src/popup/render";

beforeEach(() => {
  document.documentElement.innerHTML = readFileSync("extension/popup.html", "utf8");
});

describe("popup rendering", () => {
  it("shows the connected state, version, driven tabs and the usage hint", () => {
    renderPopup(document, {
      version: "0.1.1",
      connected: true,
      detail: "native host connected",
      drivenTabs: [{ tabId: 3, title: "Example", url: "https://example.test/" }],
    });
    expect(document.getElementById("version")!.textContent).toBe("v0.1.1");
    expect(document.getElementById("dot")!.classList.contains("connected")).toBe(true);
    expect(document.getElementById("state")!.textContent).toBe("Connected to Claude Code");
    expect(document.querySelector("#tabs li")!.textContent).toBe("Example https://example.test/");
    expect(document.getElementById("hint")!.textContent).toBe(USAGE_HINT);
  });
  it("explains what to do when disconnected and lists no tabs", () => {
    renderPopup(document, {
      version: "0.1.1",
      connected: false,
      detail: "disconnected: host exited",
      drivenTabs: [],
    });
    expect(document.getElementById("state")!.textContent).toBe("Not connected");
    expect(document.getElementById("hint")!.textContent).toMatch(/scripts\/setup.*Reconnect/);
    expect(document.querySelector("#tabs li")!.textContent).toMatch(/none yet/);
  });
});
