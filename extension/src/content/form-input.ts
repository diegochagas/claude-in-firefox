import { elementByRef } from "./refs";
import { labelElement } from "./target-point";
import { dispatchChange } from "./editable";

function fireInputAndChange(element: Element): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  dispatchChange(element);
}

function setChecked(input: HTMLInputElement, value: unknown): string {
  const wanted = value === true || value === "true" || value === 1 || value === "1";
  if (input.checked !== wanted) input.click();
  return `${labelElement(input)} is now ${input.checked ? "checked" : "unchecked"}`;
}

function selectOption(select: HTMLSelectElement, value: unknown): string {
  const wanted = String(value).trim().toLowerCase();
  const options = Array.from(select.options);
  const match =
    options.find((option) => option.value.toLowerCase() === wanted) ??
    options.find((option) => option.text.trim().toLowerCase() === wanted);
  if (!match) {
    throw new Error(
      `no option "${String(value)}" in ${labelElement(select)}: expected one of ${options.map((option) => JSON.stringify(option.text.trim())).join(", ")}`,
    );
  }
  select.value = match.value;
  fireInputAndChange(select);
  return `${labelElement(select)} now selects ${JSON.stringify(match.text.trim())}`;
}

function setTextValue(control: HTMLInputElement | HTMLTextAreaElement, value: unknown): string {
  control.focus({ preventScroll: true });
  control.value = String(value);
  fireInputAndChange(control);
  return `${labelElement(control)} value set (${control.value.length} characters)`;
}

function setEditableText(element: HTMLElement, value: unknown): string {
  element.focus({ preventScroll: true });
  element.textContent = String(value);
  element.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }),
  );
  return `${labelElement(element)} text set (${String(value).length} characters)`;
}

/**
 * Set the value of a form element by ref.
 *
 * Example: setFormValue("ref_9", "São Paulo") → 'textbox "City" [ref_9] value set (9 characters)'
 */
export function setFormValue(ref: string, value: unknown): string {
  const element = elementByRef(ref);
  if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type))
    return setChecked(element, value);
  if (element instanceof HTMLSelectElement) return selectOption(element, value);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
    return setTextValue(element, value);
  if ((element as HTMLElement).isContentEditable)
    return setEditableText(element as HTMLElement, value);
  throw new Error(
    `${labelElement(element)} is not a form element: expected input, textarea, select or contenteditable`,
  );
}
