// Tiny Markdown → DOM renderer for assistant text (no innerHTML: extension pages run under a
// CSP and the text comes from the model). Covers fenced code, headings, lists, paragraphs,
// inline code, bold and links; everything else stays literal.

const INLINE_PATTERN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;

function appendInline(document: Document, parent: HTMLElement, text: string): void {
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    parent.append(text.slice(last, match.index));
    parent.append(inlineNode(document, match));
    last = match.index + match[0].length;
  }
  parent.append(text.slice(last));
}

function inlineNode(document: Document, match: RegExpMatchArray): Node {
  const [, code, bold, link, href] = match;
  if (code) return elementWithText(document, "code", code.slice(1, -1));
  if (bold) return elementWithText(document, "strong", bold.slice(2, -2));
  const anchor = elementWithText(document, "a", link!.slice(1, link!.indexOf("]")));
  anchor.href = href!;
  // The sidebar must not navigate itself away: links open as tabs.
  anchor.target = "_blank";
  anchor.rel = "noopener";
  return anchor;
}

function elementWithText<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function blockFor(document: Document, lines: string[]): HTMLElement {
  const first = lines[0] ?? "";
  const heading = /^(#{1,3})\s+(.*)$/.exec(first);
  if (heading && lines.length === 1) {
    const element = document.createElement(`h${heading[1]!.length}` as "h1" | "h2" | "h3");
    appendInline(document, element, heading[2]!);
    return element;
  }
  if (lines.every((line) => /^(\s*[-*]|\s*\d+\.)\s+/.test(line))) return listFor(document, lines);
  const paragraph = document.createElement("p");
  appendInline(document, paragraph, lines.join("\n"));
  return paragraph;
}

function listFor(document: Document, lines: string[]): HTMLElement {
  const ordered = /^\s*\d+\./.test(lines[0] ?? "");
  const list = document.createElement(ordered ? "ol" : "ul");
  for (const line of lines) {
    const item = document.createElement("li");
    appendInline(document, item, line.replace(/^(\s*[-*]|\s*\d+\.)\s+/, ""));
    list.append(item);
  }
  return list;
}

function appendProse(document: Document, fragment: DocumentFragment, prose: string): void {
  for (const chunk of prose.split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length > 0) fragment.append(blockFor(document, lines));
  }
}

/** Example: renderMarkdown(document, "**Hi**\n\n```js\n1\n```") → fragment with <p> and <pre> */
export function renderMarkdown(document: Document, text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const parts = text.split(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/m);
  parts.forEach((part, index) => {
    if (index % 2 === 1) fragment.append(elementWithText(document, "pre", part.replace(/\n$/, "")));
    else appendProse(document, fragment, part);
  });
  return fragment;
}
