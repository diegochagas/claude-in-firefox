// Turns one DOM element into the role/name/state line the model reads. Roles follow the
// HTML-AAM implicit role mapping closely enough for navigation; this is not a full AT tree.
import { refFor } from "./refs";

const IMPLICIT_ROLES: Record<string, string> = {
  a: "link",
  button: "button",
  select: "combobox",
  textarea: "textbox",
  img: "img",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  section: "region",
  form: "form",
  article: "article",
  ul: "list",
  ol: "list",
  li: "listitem",
  table: "table",
  tr: "row",
  td: "cell",
  th: "columnheader",
  p: "paragraph",
  label: "label",
  option: "option",
  summary: "button",
  details: "group",
  dialog: "dialog",
  iframe: "iframe",
  video: "video",
  audio: "audio",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
};

const INPUT_ROLES: Record<string, string> = {
  checkbox: "checkbox",
  radio: "radio",
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  range: "slider",
  number: "spinbutton",
  search: "searchbox",
  file: "button",
};

const INTERACTIVE_ROLES = new Set([
  "link",
  "button",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "slider",
  "spinbutton",
  "searchbox",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "gridcell",
]);

export interface ElementLine {
  role: string;
  name: string;
  ref: string;
  interactive: boolean;
  extras: string;
}

export function roleOf(element: Element): string {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit.split(/\s+/)[0] ?? explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === "input") return INPUT_ROLES[(element as HTMLInputElement).type] ?? "textbox";
  if (tag === "a" && !element.hasAttribute("href")) return "generic";
  return IMPLICIT_ROLES[tag] ?? "generic";
}

export function isInteractive(element: Element): boolean {
  if (INTERACTIVE_ROLES.has(roleOf(element))) return true;
  if ((element as HTMLElement).isContentEditable) return true;
  if (element.hasAttribute("onclick")) return true;
  const tabindex = element.getAttribute("tabindex");
  return tabindex !== null && Number(tabindex) >= 0;
}

export function truncateText(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function labelledByText(element: Element): string {
  const ids = element.getAttribute("aria-labelledby");
  if (!ids) return "";
  return ids
    .split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function associatedLabelText(element: Element): string {
  const control = element as HTMLInputElement;
  const labels = control.labels;
  if (labels && labels.length > 0) return labels[0]?.textContent ?? "";
  return element.closest("label")?.textContent ?? "";
}

/** Accessible name, roughly following accname's precedence order. */
export function accessibleName(element: Element): string {
  const candidates = [
    element.getAttribute("aria-label"),
    labelledByText(element),
    element.getAttribute("alt"),
    isFormControl(element) ? associatedLabelText(element) : "",
    element.getAttribute("placeholder"),
    element.getAttribute("title"),
    isButtonLike(element) ? (element as HTMLInputElement).value : "",
    ownTextContent(element),
  ];
  const first = candidates.find((candidate) => candidate && candidate.trim().length > 0) ?? "";
  return truncateText(first, 120);
}

function isFormControl(element: Element): boolean {
  return ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName);
}

function isButtonLike(element: Element): boolean {
  return (
    element.tagName === "INPUT" &&
    ["button", "submit", "reset"].includes((element as HTMLInputElement).type)
  );
}

function ownTextContent(element: Element): string {
  // Containers (div, section, …) get no text name: their children carry it.
  if (roleOf(element) === "generic" || isLandmark(element)) return "";
  return element.textContent ?? "";
}

function isLandmark(element: Element): boolean {
  return [
    "navigation",
    "main",
    "banner",
    "contentinfo",
    "complementary",
    "region",
    "form",
    "list",
    "table",
    "row",
    "group",
    "article",
  ].includes(roleOf(element));
}

function stateExtras(element: Element): string[] {
  const extras: string[] = [];
  const input = element as HTMLInputElement;
  if (element.tagName === "INPUT" && ["checkbox", "radio"].includes(input.type))
    extras.push(input.checked ? "checked" : "unchecked");
  else if (isFormControl(element) && input.value && !isButtonLike(element))
    extras.push(`value=${JSON.stringify(truncateText(input.value, 60))}`);
  if (input.disabled) extras.push("disabled");
  if (element.getAttribute("aria-expanded"))
    extras.push(`expanded=${element.getAttribute("aria-expanded")}`);
  if (element.getAttribute("aria-selected") === "true") extras.push("selected");
  return extras;
}

function attributeExtras(element: Element): string[] {
  const extras: string[] = [];
  const href = element.getAttribute("href");
  if (href && roleOf(element) === "link")
    extras.push(`href=${JSON.stringify(truncateText(href, 80))}`);
  if (/^h[1-6]$/i.test(element.tagName)) extras.push(`level=${element.tagName.slice(1)}`);
  return extras;
}

/** Describe an element as the model-facing line, or null when it adds no information. */
export function describeElement(element: Element): ElementLine | null {
  const role = roleOf(element);
  const name = accessibleName(element);
  const interactive = isInteractive(element);
  if (role === "generic" && !interactive && !name) return null;
  const extras = [...stateExtras(element), ...attributeExtras(element)].join(" ");
  return { role, name, ref: refFor(element), interactive, extras };
}

export function formatLine(line: ElementLine): string {
  const name = line.name ? ` ${JSON.stringify(line.name)}` : "";
  const extras = line.extras ? ` ${line.extras}` : "";
  return `${line.role}${name} [${line.ref}]${extras}`;
}
