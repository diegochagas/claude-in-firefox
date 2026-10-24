// Synthesises mouse interactions. Events are untrusted (isTrusted=false), which is enough
// for links, buttons, form controls and framework handlers; it cannot open file pickers or
// popups that need a user gesture. Firefox exposes no debugger API for trusted input.
import type { PointerCommand } from "../shared/protocol";
import { parseClickModifiers } from "../shared/key-names";
import { labelElement, resolveTarget, type TargetPoint } from "./target-point";

type ModifierFlags = ReturnType<typeof parseClickModifiers>;

function mouseInit(
  point: TargetPoint,
  flags: ModifierFlags,
  button: number,
  detail: number,
): MouseEventInit {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    screenX: point.x + window.screenX,
    screenY: point.y + window.screenY,
    button,
    buttons: button === 2 ? 2 : 1,
    detail,
    ...flags,
  };
}

function fire(target: Element, type: string, init: MouseEventInit, pointer = false): boolean {
  const event = pointer
    ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true })
    : new MouseEvent(type, init);
  return target.dispatchEvent(event);
}

function moveTo(point: TargetPoint, flags: ModifierFlags): void {
  const init = { ...mouseInit(point, flags, 0, 0), buttons: 0 };
  fire(point.element, "pointermove", init, true);
  fire(point.element, "mouseover", init);
  fire(point.element, "mouseenter", { ...init, bubbles: false });
  fire(point.element, "mousemove", init);
}

function focusTarget(element: Element): void {
  const focusable = element.closest(
    "a[href], button, input, select, textarea, [tabindex], [contenteditable]",
  ) as HTMLElement | null;
  if (focusable && focusable !== document.activeElement) focusable.focus({ preventScroll: true });
}

function press(point: TargetPoint, flags: ModifierFlags, button: number, detail: number): void {
  const init = mouseInit(point, flags, button, detail);
  fire(point.element, "pointerdown", init, true);
  const proceed = fire(point.element, "mousedown", init);
  if (proceed) focusTarget(point.element);
  fire(point.element, "pointerup", { ...init, buttons: 0 }, true);
  fire(point.element, "mouseup", { ...init, buttons: 0 });
}

function click(point: TargetPoint, flags: ModifierFlags, detail: number): void {
  press(point, flags, 0, detail);
  fire(point.element, "click", { ...mouseInit(point, flags, 0, detail), buttons: 0 });
}

function rightClick(point: TargetPoint, flags: ModifierFlags): void {
  press(point, flags, 2, 1);
  fire(point.element, "contextmenu", mouseInit(point, flags, 2, 1));
}

function selectTextOf(element: Element): void {
  const control = element as HTMLInputElement;
  if (typeof control.select === "function" && "value" in control) return control.select();
  window.getSelection()?.selectAllChildren(element);
}

function tripleClick(point: TargetPoint, flags: ModifierFlags): void {
  click(point, flags, 1);
  click(point, flags, 2);
  fire(point.element, "dblclick", mouseInit(point, flags, 0, 2));
  click(point, flags, 3);
  selectTextOf(point.element);
}

function dragData(): DataTransfer | undefined {
  try {
    return new DataTransfer();
  } catch {
    return undefined;
  }
}

type DragInit = (point: TargetPoint) => DragEventInit;

function dragInitFor(flags: ModifierFlags): DragInit {
  const dataTransfer = dragData();
  return (point) => ({ ...mouseInit(point, flags, 0, 1), dataTransfer });
}

function moveAlong(start: TargetPoint, end: TargetPoint, flags: ModifierFlags): void {
  for (const step of [0.25, 0.5, 0.75, 1]) {
    const mid = {
      x: start.x + (end.x - start.x) * step,
      y: start.y + (end.y - start.y) * step,
      element: end.element,
    };
    fire(end.element, "pointermove", mouseInit(mid, flags, 0, 1), true);
    fire(end.element, "mousemove", mouseInit(mid, flags, 0, 1));
  }
}

function dropOn(
  start: TargetPoint,
  end: TargetPoint,
  flags: ModifierFlags,
  dragInit: DragInit,
): void {
  end.element.dispatchEvent(new DragEvent("dragenter", dragInit(end)));
  end.element.dispatchEvent(new DragEvent("dragover", dragInit(end)));
  end.element.dispatchEvent(new DragEvent("drop", dragInit(end)));
  start.element.dispatchEvent(new DragEvent("dragend", dragInit(end)));
  fire(end.element, "pointerup", { ...mouseInit(end, flags, 0, 1), buttons: 0 }, true);
  fire(end.element, "mouseup", { ...mouseInit(end, flags, 0, 1), buttons: 0 });
}

function drag(start: TargetPoint, end: TargetPoint, flags: ModifierFlags): void {
  const dragInit = dragInitFor(flags);
  moveTo(start, flags);
  fire(start.element, "pointerdown", mouseInit(start, flags, 0, 1), true);
  fire(start.element, "mousedown", mouseInit(start, flags, 0, 1));
  start.element.dispatchEvent(new DragEvent("dragstart", dragInit(start)));
  moveAlong(start, end, flags);
  dropOn(start, end, flags, dragInit);
}

function performSimpleAction(
  command: PointerCommand,
  point: TargetPoint,
  flags: ModifierFlags,
): void {
  moveTo(point, flags);
  if (command.action === "hover") return;
  if (command.action === "left_click") return click(point, flags, 1);
  if (command.action === "right_click") return rightClick(point, flags);
  if (command.action === "triple_click") return tripleClick(point, flags);
  click(point, flags, 1);
  click(point, flags, 2);
  fire(point.element, "dblclick", mouseInit(point, flags, 0, 2));
}

/**
 * Run one pointer action and describe what it hit.
 *
 * Example: performPointerAction({ kind: "pointer", action: "left_click", x: 120, y: 44 })
 *   → 'left_click at (120, 44) on button "Search" [ref_2]'
 */
export function performPointerAction(command: PointerCommand): string {
  const flags = parseClickModifiers(command.modifiers);
  const target = resolveTarget(command.ref, command.x, command.y);
  if (command.action === "left_click_drag") {
    const start = resolveTarget(undefined, command.startX, command.startY);
    drag(start, target, flags);
    return `dragged from (${start.x}, ${start.y}) ${labelElement(start.element)} to (${target.x}, ${target.y}) ${labelElement(target.element)}`;
  }
  performSimpleAction(command, target, flags);
  return `${command.action} at (${Math.round(target.x)}, ${Math.round(target.y)}) on ${labelElement(target.element)}`;
}
