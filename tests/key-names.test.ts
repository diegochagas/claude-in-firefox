import { describe, expect, it } from "vitest";
import {
  parseClickModifiers,
  parseKeyCombo,
  splitKeySequence,
} from "../extension/src/shared/key-names";

describe("parseKeyCombo", () => {
  it("maps named keys to KeyboardEvent fields", () => {
    expect(parseKeyCombo("Return")).toMatchObject({ key: "Enter", code: "Enter", ctrlKey: false });
    expect(parseKeyCombo("Page_Down")).toMatchObject({ key: "PageDown", code: "PageDown" });
    expect(parseKeyCombo("space")).toMatchObject({ key: " ", code: "Space" });
  });
  it("applies modifiers in any order and case", () => {
    expect(parseKeyCombo("ctrl+shift+Tab")).toMatchObject({
      key: "Tab",
      ctrlKey: true,
      shiftKey: true,
      metaKey: false,
    });
    expect(parseKeyCombo("CMD+a")).toMatchObject({ key: "a", code: "KeyA", metaKey: true });
  });
  it("accepts function keys and single characters", () => {
    expect(parseKeyCombo("F5")).toMatchObject({ key: "F5", code: "F5" });
    expect(parseKeyCombo("7")).toMatchObject({ key: "7", code: "Digit7" });
    expect(parseKeyCombo("+")).toMatchObject({ key: "+", code: "" });
  });
  it("rejects unknown names with the offending value", () => {
    expect(() => parseKeyCombo("Bogus")).toThrow(/unknown key "Bogus"/);
    expect(() => parseKeyCombo("hyper+a")).toThrow(/unknown modifier "hyper"/);
  });
});

describe("splitKeySequence / parseClickModifiers", () => {
  it("splits space-separated sequences", () => {
    expect(splitKeySequence("  Backspace Backspace  Delete ")).toEqual([
      "Backspace",
      "Backspace",
      "Delete",
    ]);
  });
  it("parses click modifiers", () => {
    expect(parseClickModifiers("ctrl+shift")).toEqual({
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    });
    expect(parseClickModifiers(undefined)).toEqual({
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
    expect(() => parseClickModifiers("hyper")).toThrow(/unknown modifier "hyper"/);
  });
});
