// Walks the DOM into an indented, YAML-like outline for read_page and a flat list for find.
import { describeElement, formatLine, truncateText, type ElementLine } from "./element-description";
import { elementByRef } from "./refs";
import type { ReadPageCommand } from "../shared/protocol";

const SKIPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "HEAD",
  "META",
  "LINK",
  "TITLE",
  "SVG",
  "PATH",
]);
const MAX_NODES = 5000;

interface OutlineNode {
  line: ElementLine | null;
  text: string;
  children: OutlineNode[];
}

function isRendered(element: Element): boolean {
  if (SKIPPED_TAGS.has(element.tagName)) return false;
  if (element.getAttribute("aria-hidden") === "true" || (element as HTMLElement).hidden)
    return false;
  if (element.checkVisibility) return element.checkVisibility({ checkVisibilityCSS: true });
  return true;
}

function directText(element: Element): string {
  const pieces: string[] = [];
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent) pieces.push(node.textContent);
  }
  return truncateText(pieces.join(" "), 200);
}

class OutlineBuilder {
  private visited = 0;

  build(element: Element, depthLeft: number): OutlineNode | null {
    if (!isRendered(element) || this.visited++ > MAX_NODES) return null;
    const line = describeElement(element);
    const children = depthLeft > 0 ? this.buildChildren(element, depthLeft - 1) : [];
    const text = line && line.name ? "" : directText(element);
    if (!line && children.length === 0 && !text) return null;
    return { line, text, children };
  }

  private buildChildren(element: Element, depthLeft: number): OutlineNode[] {
    const nodes: OutlineNode[] = [];
    const children = element.shadowRoot ? element.shadowRoot.children : element.children;
    for (const child of children) {
      const node = this.build(child, depthLeft);
      if (!node) continue;
      // Transparent wrappers (generic, unnamed) are flattened into their parent.
      if (node.line) nodes.push(node);
      else nodes.push(...liftTransparent(node));
    }
    return nodes;
  }
}

function liftTransparent(node: OutlineNode): OutlineNode[] {
  const lifted = [...node.children];
  if (node.text) lifted.unshift({ line: null, text: node.text, children: [] });
  return lifted;
}

function renderOutline(nodes: OutlineNode[], indent: string, out: string[]): void {
  for (const node of nodes) {
    if (node.line) out.push(`${indent}- ${formatLine(node.line)}`);
    else if (node.text) out.push(`${indent}- text ${JSON.stringify(node.text)}`);
    if (node.text && node.line) out.push(`${indent}  - text ${JSON.stringify(node.text)}`);
    renderOutline(node.children, node.line ? `${indent}  ` : indent, out);
  }
}

function collectInteractive(nodes: OutlineNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.line?.interactive) out.push(`- ${formatLine(node.line)}`);
    collectInteractive(node.children, out);
  }
}

function rootFor(command: ReadPageCommand): Element {
  return command.refId ? elementByRef(command.refId) : document.documentElement;
}

/** Full outline lines of the document (or of a ref's subtree). */
export function outlineLines(command: ReadPageCommand): string[] {
  const root = new OutlineBuilder().build(rootFor(command), command.depth);
  if (!root) return [];
  const lines: string[] = [];
  const nodes = root.line ? [root] : root.children;
  if (command.filter === "interactive") collectInteractive(nodes, lines);
  else renderOutline(nodes, "", lines);
  return lines;
}

/** Every described element of the page as a flat line, for find. */
export function flatElementLines(): string[] {
  const lines: string[] = [];
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode() as Element | null;
  while (current && lines.length < MAX_NODES) {
    if (isRendered(current)) {
      const line = describeElement(current);
      if (line) lines.push(formatLine(line));
    }
    current = walker.nextNode() as Element | null;
  }
  return lines;
}

/** Join lines and cut at maxChars with an explicit truncation note. */
export function joinWithLimit(lines: string[], maxChars: number): string {
  const text = lines.join("\n");
  if (text.length <= maxChars) return text;
  const kept = text.slice(0, maxChars);
  return `${kept}\n[truncated: ${text.length - maxChars} more characters; raise max_chars or pass ref_id/depth to focus]`;
}
