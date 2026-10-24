// Stable element references ("ref_12") handed to the model by read_page/find and accepted
// back by click/form_input/scroll_to. They live as long as this document's content script.

const elementsByRef = new Map<string, Element>();
const refsByElement = new WeakMap<Element, string>();
let nextRefNumber = 1;

/** Return the existing ref for an element or mint a new one. */
export function refFor(element: Element): string {
  const existing = refsByElement.get(element);
  if (existing) return existing;
  const ref = `ref_${nextRefNumber++}`;
  refsByElement.set(element, ref);
  elementsByRef.set(ref, element);
  return ref;
}

/**
 * Resolve a ref back to its element, failing loudly when the page has changed.
 *
 * Example: elementByRef("ref_3") → HTMLButtonElement
 */
export function elementByRef(ref: string): Element {
  const element = elementsByRef.get(ref);
  if (!element || !element.isConnected) {
    throw new Error(
      `unknown ref "${ref}": expected a ref_N returned by read_page or find on the current page (refs reset on navigation)`,
    );
  }
  return element;
}

export function knownRefCount(): number {
  return elementsByRef.size;
}
