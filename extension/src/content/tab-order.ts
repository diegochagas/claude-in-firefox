// Tab-key focus movement: the tabbable elements in document order, honouring positive tabindex.

const TABBABLE_SELECTOR =
  "a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable=true]";

function isTabbable(element: Element): boolean {
  const control = element as HTMLInputElement;
  if (control.disabled || element.getAttribute("tabindex") === "-1") return false;
  if (element instanceof HTMLInputElement && element.type === "hidden") return false;
  return element.checkVisibility ? element.checkVisibility({ checkVisibilityCSS: true }) : true;
}

function tabIndexOf(element: Element): number {
  return Number(element.getAttribute("tabindex") ?? 0);
}

export function tabbableElements(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    isTabbable,
  );
  const positive = all
    .filter((element) => tabIndexOf(element) > 0)
    .sort((a, b) => tabIndexOf(a) - tabIndexOf(b));
  const normal = all.filter((element) => tabIndexOf(element) === 0);
  return [...positive, ...normal];
}

/** Move focus like Tab (direction 1) or Shift+Tab (direction -1). */
export function focusNextTabbable(direction: 1 | -1): void {
  const order = tabbableElements();
  if (order.length === 0) return;
  const current = order.indexOf(document.activeElement as HTMLElement);
  const fromEdge = direction === 1 ? 0 : order.length - 1;
  const next = current === -1 ? fromEdge : (current + direction + order.length) % order.length;
  order[next]?.focus();
}
