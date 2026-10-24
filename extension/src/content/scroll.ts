import type { ScrollCommand } from "../shared/protocol";
import { elementByRef } from "./refs";
import { labelElement, pointFromCoordinate } from "./target-point";

const PIXELS_PER_TICK = 100;

function isScrollable(element: Element): boolean {
  const style = getComputedStyle(element);
  const scrollsY =
    /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
  const scrollsX =
    /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
  return scrollsY || scrollsX;
}

function scrollableAncestor(element: Element): Element | null {
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    if (isScrollable(current)) return current;
    current = current.parentElement;
  }
  return null;
}

function deltaFor(command: ScrollCommand): { x: number; y: number } {
  const distance = command.ticks * PIXELS_PER_TICK;
  if (command.direction === "up") return { x: 0, y: -distance };
  if (command.direction === "down") return { x: 0, y: distance };
  if (command.direction === "left") return { x: -distance, y: 0 };
  return { x: distance, y: 0 };
}

/** Scroll the scrollable container under (x, y), or the window, by ticks of 100px. */
export function scrollAtPoint(command: ScrollCommand): string {
  const point = pointFromCoordinate(command.x, command.y);
  const delta = deltaFor(command);
  if (!point.element.dispatchEvent(wheelEvent(point.x, point.y, delta)))
    return `wheel event handled by the page at (${command.x}, ${command.y})`;
  const container = scrollableAncestor(point.element);
  if (container) {
    container.scrollBy({ left: delta.x, top: delta.y, behavior: "instant" });
    return `scrolled ${labelElement(container)} by (${delta.x}, ${delta.y}) → scrollTop ${container.scrollTop}`;
  }
  window.scrollBy({ left: delta.x, top: delta.y, behavior: "instant" });
  return `scrolled window by (${delta.x}, ${delta.y}) → (${window.scrollX}, ${window.scrollY}) of ${document.documentElement.scrollWidth}×${document.documentElement.scrollHeight}`;
}

function wheelEvent(clientX: number, clientY: number, delta: { x: number; y: number }): WheelEvent {
  return new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    deltaX: delta.x,
    deltaY: delta.y,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
  });
}

export function scrollToRef(ref: string): string {
  const element = elementByRef(ref);
  element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = element.getBoundingClientRect();
  return `${labelElement(element)} is now at viewport (${Math.round(rect.left)}, ${Math.round(rect.top)}) ${Math.round(rect.width)}×${Math.round(rect.height)}`;
}
