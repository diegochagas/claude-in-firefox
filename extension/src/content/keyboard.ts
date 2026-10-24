// Key presses and typing. Dispatches keydown/keypress/keyup, then applies the default action
// the browser would have applied for a trusted event (text insertion, Enter submits, Tab moves
// focus, Space activates), since untrusted key events have no default behaviour.
import type { KeyboardCommand } from "../shared/protocol";
import { parseKeyCombo, splitKeySequence, type KeyDescription } from "../shared/key-names";
import {
  deleteCharacter,
  dispatchChange,
  focusedTextControl,
  insertText,
  moveCaret,
  selectAllInFocused,
} from "./editable";
import { focusNextTabbable } from "./tab-order";

function keyboardTarget(): Element {
  return document.activeElement ?? document.body;
}

function fireKey(type: string, key: KeyDescription, repeat = false): boolean {
  const init: KeyboardEventInit = {
    ...key,
    bubbles: true,
    cancelable: true,
    composed: true,
    repeat,
  };
  return keyboardTarget().dispatchEvent(new KeyboardEvent(type, init));
}

function hasCommandModifier(key: KeyDescription): boolean {
  return key.ctrlKey || key.metaKey || key.altKey;
}

function submitFocusedForm(): boolean {
  const control = focusedTextControl();
  const form = control?.form;
  if (!form || control instanceof HTMLTextAreaElement) return false;
  if (typeof form.requestSubmit === "function") form.requestSubmit();
  else form.submit();
  return true;
}

function activateFocused(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return false;
  const activatable = active.matches(
    "a[href], button, input[type=button], input[type=submit], input[type=checkbox], input[type=radio], summary, [role=button], [role=link]",
  );
  if (activatable) active.click();
  return activatable;
}

function moveSelectOption(step: number): boolean {
  const select = document.activeElement;
  if (!(select instanceof HTMLSelectElement)) return false;
  const next = Math.min(select.options.length - 1, Math.max(0, select.selectedIndex + step));
  if (next === select.selectedIndex) return true;
  select.selectedIndex = next;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  dispatchChange(select);
  return true;
}

function applyEnter(key: KeyDescription): void {
  if (document.activeElement instanceof HTMLTextAreaElement && !hasCommandModifier(key)) {
    insertText("\n");
    return;
  }
  if (!submitFocusedForm()) activateFocused();
}

const DEFAULT_ACTIONS: Record<string, (key: KeyDescription) => void> = {
  Enter: applyEnter,
  Backspace: () => deleteCharacter(-1),
  Delete: () => deleteCharacter(1),
  Tab: (key) => focusNextTabbable(key.shiftKey ? -1 : 1),
  " ": () => {
    if (!insertText(" ")) activateFocused();
  },
  ArrowDown: () => moveSelectOption(1),
  ArrowUp: () => moveSelectOption(-1),
  ArrowLeft: (key) => moveCaret("backward", key.ctrlKey ? "word" : "character"),
  ArrowRight: (key) => moveCaret("forward", key.ctrlKey ? "word" : "character"),
  Home: (key) => moveCaret("backward", key.ctrlKey ? "documentboundary" : "lineboundary"),
  End: (key) => moveCaret("forward", key.ctrlKey ? "documentboundary" : "lineboundary"),
};

function applyDefaultAction(key: KeyDescription): void {
  if ((key.ctrlKey || key.metaKey) && key.key.toLowerCase() === "a") return selectAllInFocused();
  const action = DEFAULT_ACTIONS[key.key];
  if (action) return action(key);
  if (key.key.length === 1 && !hasCommandModifier(key)) insertText(key.key);
}

function pressOnce(key: KeyDescription): void {
  const proceed = fireKey("keydown", key);
  if (key.key.length === 1 || key.key === "Enter") fireKey("keypress", key);
  if (proceed) applyDefaultAction(key);
  fireKey("keyup", key);
}

function typeCharacter(character: string): void {
  const key = parseKeyCombo(character === "\n" ? "Return" : character);
  key.shiftKey = character !== character.toLowerCase() && character === character.toUpperCase();
  const proceed = fireKey("keydown", key);
  fireKey("keypress", key);
  if (proceed && !insertText(character === "\n" ? "\n" : character) && character === "\n")
    applyEnter(key);
  fireKey("keyup", key);
}

/**
 * Type literal text into the focused element, or press a key sequence.
 *
 * Example: performKeyboardAction({ kind: "keyboard", action: "key", text: "ctrl+a Backspace" })
 */
export function performKeyboardAction(command: KeyboardCommand): string {
  if (command.action === "type") {
    for (const character of command.text) typeCharacter(character);
    return `typed ${command.text.length} characters into ${describeActive()}`;
  }
  const combos = splitKeySequence(command.text);
  const repeat = Math.max(1, command.repeat ?? 1);
  for (let i = 0; i < repeat; i++) combos.forEach((combo) => pressOnce(parseKeyCombo(combo)));
  return `pressed ${combos.join(" ")}${repeat > 1 ? ` ×${repeat}` : ""} on ${describeActive()}`;
}

function describeActive(): string {
  const active = document.activeElement;
  if (!active || active === document.body) return "the page (nothing focused)";
  const control = active as HTMLInputElement;
  const value =
    "value" in control && typeof control.value === "string"
      ? ` value=${JSON.stringify(control.value.slice(0, 80))}`
      : "";
  return `<${active.tagName.toLowerCase()}>${value}`;
}
