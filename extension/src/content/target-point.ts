// Resolves where a pointer action lands: a viewport coordinate or a ref's centre.
import { elementByRef } from "./refs";
import { describeElement, formatLine } from "./element-description";

export interface TargetPoint {
  x: number;
  y: number;
  element: Element;
}

function viewportSize(): string {
  return `${window.innerWidth}×${window.innerHeight}`;
}

export function pointFromCoordinate(x: number, y: number): TargetPoint {
  const element = document.elementFromPoint(x, y);
  if (!element) {
    throw new Error(
      `no element at (${x}, ${y}): the viewport is ${viewportSize()} CSS pixels; take a new screenshot`,
    );
  }
  return { x, y, element };
}

export function pointFromRef(ref: string): TargetPoint {
  const element = elementByRef(ref);
  scrollIntoViewIfNeeded(element);
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  // Overlays can cover the element; clicks still target the element itself, like a user would.
  return { x, y, element };
}

export function scrollIntoViewIfNeeded(element: Element): void {
  const rect = element.getBoundingClientRect();
  const visible =
    rect.top >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.left >= 0 &&
    rect.right <= window.innerWidth;
  if (!visible) element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
}

export function resolveTarget(
  ref: string | undefined,
  x: number | undefined,
  y: number | undefined,
): TargetPoint {
  if (ref) return pointFromRef(ref);
  if (typeof x === "number" && typeof y === "number") return pointFromCoordinate(x, y);
  throw new Error(
    `pointer action needs a coordinate [x, y] or a ref: got ref=${ref} x=${x} y=${y}`,
  );
}

/** Short label of an element for action results, e.g. `button "Save" [ref_4]`. */
export function labelElement(element: Element): string {
  const line = describeElement(element);
  return line ? formatLine(line) : `<${element.tagName.toLowerCase()}>`;
}
