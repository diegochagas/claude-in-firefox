// Text insertion/deletion in the focused editable element, with the events frameworks expect.

export type TextControl = HTMLInputElement | HTMLTextAreaElement;

export function focusedTextControl(): TextControl | null {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement) return active;
  if (
    active instanceof HTMLInputElement &&
    !["checkbox", "radio", "button", "submit", "reset", "file", "range"].includes(active.type)
  )
    return active;
  return null;
}

export function focusedContentEditable(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  return active?.isContentEditable ? active : null;
}

function dispatchInput(target: Element, inputType: string, text: string | null): void {
  target.dispatchEvent(
    new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType, data: text }),
  );
  target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, data: text }));
}

function replaceSelection(control: TextControl, text: string): void {
  try {
    control.setRangeText(
      text,
      control.selectionStart ?? control.value.length,
      control.selectionEnd ?? control.value.length,
      "end",
    );
  } catch {
    // number/email/date inputs have no selection API: append instead.
    control.value = control.value + text;
  }
}

/** Insert text at the caret of a text control or contenteditable; false when nothing editable has focus. */
export function insertText(text: string): boolean {
  const control = focusedTextControl();
  if (control) {
    replaceSelection(control, text);
    dispatchInput(control, "insertText", text);
    return true;
  }
  const editable = focusedContentEditable();
  if (!editable) return false;
  if (!document.execCommand("insertText", false, text)) insertIntoRange(editable, text);
  return true;
}

function insertIntoRange(editable: HTMLElement, text: string): void {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range) {
    editable.append(text);
  } else {
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
  }
  dispatchInput(editable, "insertText", text);
}

/** Backspace (direction -1) or Delete (direction +1) in the focused control. */
export function deleteCharacter(direction: -1 | 1): boolean {
  const control = focusedTextControl();
  if (control) {
    deleteInControl(control, direction);
    return true;
  }
  const editable = focusedContentEditable();
  if (!editable) return false;
  document.execCommand(direction < 0 ? "delete" : "forwardDelete");
  return true;
}

function deleteInControl(control: TextControl, direction: -1 | 1): void {
  const start = control.selectionStart ?? control.value.length;
  const end = control.selectionEnd ?? control.value.length;
  const [from, to] = deletionRange(start, end, direction);
  try {
    control.setRangeText("", from, to, "end");
  } catch {
    control.value = control.value.slice(0, from) + control.value.slice(to);
  }
  dispatchInput(control, direction < 0 ? "deleteContentBackward" : "deleteContentForward", null);
}

export function selectAllInFocused(): void {
  const control = focusedTextControl();
  if (control) return control.select();
  const editable = focusedContentEditable();
  window.getSelection()?.selectAllChildren(editable ?? document.body);
}

/** Commit a value change (blur-style `change` event) so listeners that ignore `input` see it. */
export function dispatchChange(target: Element): void {
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

function deletionRange(start: number, end: number, direction: -1 | 1): [number, number] {
  if (start !== end) return [start, end];
  return direction < 0 ? [Math.max(0, start - 1), start] : [start, start + 1];
}

type CaretGranularity = "character" | "word" | "lineboundary" | "documentboundary";

/** Move the caret in the focused text control or contenteditable (Home/End/arrow defaults). */
export function moveCaret(direction: "forward" | "backward", granularity: CaretGranularity): void {
  const control = focusedTextControl();
  if (control) return moveControlCaret(control, direction, granularity);
  const selection = window.getSelection();
  if (focusedContentEditable() && selection) selection.modify("move", direction, granularity);
}

function moveControlCaret(
  control: TextControl,
  direction: "forward" | "backward",
  granularity: CaretGranularity,
): void {
  const length = control.value.length;
  const current =
    (direction === "forward" ? control.selectionEnd : control.selectionStart) ?? length;
  const boundary = direction === "forward" ? length : 0;
  const step = direction === "forward" ? Math.min(length, current + 1) : Math.max(0, current - 1);
  const target = granularity === "character" ? step : boundary;
  try {
    control.setSelectionRange(target, target);
  } catch {
    // inputs without a selection API (number, email in Firefox): nothing to move
  }
}
