// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { joinWithLimit, outlineLines } from "../extension/src/content/accessibility-tree";
import { findElements } from "../extension/src/content/find";
import { setFormValue } from "../extension/src/content/form-input";
import { performKeyboardAction } from "../extension/src/content/keyboard";
import { performPointerAction } from "../extension/src/content/pointer";
import { elementByRef } from "../extension/src/content/refs";
import { tabbableElements } from "../extension/src/content/tab-order";

const PAGE = `
  <nav><a href="/home">Home</a><a href="/login" aria-label="Sign in">→</a></nav>
  <main>
    <h2>Search</h2>
    <form id="f"><label for="q">Query</label><input id="q" placeholder="type here"><select id="s"><option value="br">Brazil</option><option value="pt">Portugal</option></select>
      <input type="checkbox" id="c"><button type="submit">Go</button></form>
    <div><span>plain text</span><div hidden>secret</div></div>
  </main>`;

beforeEach(() => {
  document.body.innerHTML = PAGE;
  Element.prototype.scrollIntoView = () => undefined;
});

function readAll(): string {
  return outlineLines({ kind: "read", filter: "all", depth: 15, maxChars: 50_000 }).join("\n");
}

describe("read_page outline", () => {
  it("lists roles, names, refs and attributes, skipping hidden nodes", () => {
    const text = readAll();
    expect(text).toMatch(/- navigation \[ref_\d+\]\n  - link "Home" \[ref_\d+\] href="\/home"/);
    expect(text).toContain('link "Sign in"');
    expect(text).toMatch(/heading "Search" \[ref_\d+\] level=2/);
    expect(text).toMatch(/textbox "Query" \[ref_\d+\]/);
    expect(text).toMatch(/checkbox \[ref_\d+\] unchecked/);
    expect(text).toContain('text "plain text"');
    expect(text).not.toContain("secret");
  });
  it("gives the same element the same ref across reads and supports the interactive filter", () => {
    const first = /textbox "Query" \[(ref_\d+)\]/.exec(readAll())?.[1];
    const interactive = outlineLines({
      kind: "read",
      filter: "interactive",
      depth: 15,
      maxChars: 50_000,
    });
    expect(interactive.join("\n")).toContain(`textbox "Query" [${first}]`);
    expect(interactive.every((line) => line.startsWith("- "))).toBe(true);
    expect(interactive.join("\n")).not.toContain("heading");
  });
  it("truncates with a note", () => {
    expect(joinWithLimit(["a".repeat(10), "b".repeat(10)], 12)).toMatch(
      /^a{10}\nb\n\[truncated: 9 more characters/,
    );
  });
});

describe("find", () => {
  it("matches role, name and attributes case-insensitively, max 20", () => {
    const matches = findElements("sign IN");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.line).toContain('link "Sign in"');
    expect(elementByRef(matches[0]!.ref).getAttribute("href")).toBe("/login");
    expect(() => findElements("  ")).toThrow(/empty find query/);
  });
});

describe("form_input", () => {
  it("sets text, select, checkbox values and fires events", () => {
    const events: string[] = [];
    document
      .getElementById("f")!
      .addEventListener("input", (event) => events.push(`input:${(event.target as Element).id}`));
    document
      .getElementById("f")!
      .addEventListener("change", (event) => events.push(`change:${(event.target as Element).id}`));
    const [query] = findElements('textbox "Query"');
    const [select] = findElements("combobox");
    const [checkbox] = findElements("checkbox");
    expect(setFormValue(query!.ref, "seiya")).toMatch(/value set \(5 characters\)/);
    expect(setFormValue(select!.ref, "portugal")).toMatch(/selects "Portugal"/);
    expect(setFormValue(checkbox!.ref, true)).toMatch(/is now checked/);
    expect((document.getElementById("s") as HTMLSelectElement).value).toBe("pt");
    expect(events).toEqual(["input:q", "change:q", "input:s", "change:s", "input:c", "change:c"]);
    expect(() => setFormValue(select!.ref, "spain")).toThrow(
      /no option "spain".*"Brazil", "Portugal"/,
    );
  });
});

describe("pointer and keyboard", () => {
  it("clicks by ref, focusing the target and running the click handler", () => {
    let clicks = 0;
    document.querySelector("button")!.addEventListener("click", () => clicks++);
    const [button] = findElements('button "Go"');
    expect(
      performPointerAction({ kind: "pointer", action: "left_click", ref: button!.ref }),
    ).toMatch(/left_click at \(\d+, \d+\) on button "Go"/);
    expect(clicks).toBe(1);
    expect(document.activeElement).toBe(document.querySelector("button"));
  });
  it("fails loudly for an unknown ref or empty coordinate", () => {
    expect(() =>
      performPointerAction({ kind: "pointer", action: "left_click", ref: "ref_999" }),
    ).toThrow(/unknown ref "ref_999"/);
    expect(() => performPointerAction({ kind: "pointer", action: "hover" })).toThrow(
      /needs a coordinate/,
    );
  });
  it("types into the focused input, handles Backspace, ctrl+a and Enter submit", () => {
    const input = document.getElementById("q") as HTMLInputElement;
    const form = document.getElementById("f") as HTMLFormElement;
    let submitted = 0;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted++;
    });
    form.requestSubmit = () => form.dispatchEvent(new Event("submit", { cancelable: true }));
    input.focus();
    expect(performKeyboardAction({ kind: "keyboard", action: "type", text: "Pegasus!" })).toMatch(
      /typed 8 characters/,
    );
    expect(input.value).toBe("Pegasus!");
    performKeyboardAction({ kind: "keyboard", action: "key", text: "Backspace", repeat: 2 });
    expect(input.value).toBe("Pegasu");
    performKeyboardAction({ kind: "keyboard", action: "key", text: "ctrl+a Delete" });
    expect(input.value).toBe("");
    performKeyboardAction({ kind: "keyboard", action: "key", text: "Return" });
    expect(submitted).toBe(1);
  });
  it("moves focus with Tab in document order", () => {
    expect(tabbableElements().map((element) => element.id || element.tagName)).toEqual([
      "A",
      "A",
      "q",
      "s",
      "c",
      "BUTTON",
    ]);
    (document.getElementById("q") as HTMLInputElement).focus();
    performKeyboardAction({ kind: "keyboard", action: "key", text: "Tab" });
    expect(document.activeElement?.id).toBe("s");
    performKeyboardAction({ kind: "keyboard", action: "key", text: "shift+Tab" });
    expect(document.activeElement?.id).toBe("q");
  });
});
