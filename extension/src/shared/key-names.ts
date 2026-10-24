// Maps the key names the model types ("Return", "cmd+a", "Page_Down") to KeyboardEvent
// fields. Names follow xdotool/Chrome-extension conventions so prompts written for Claude in
// Chrome keep working.

export interface KeyDescription {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const NAMED_KEYS: Record<string, { key: string; code: string }> = {
  return: { key: "Enter", code: "Enter" },
  enter: { key: "Enter", code: "Enter" },
  tab: { key: "Tab", code: "Tab" },
  backspace: { key: "Backspace", code: "Backspace" },
  delete: { key: "Delete", code: "Delete" },
  escape: { key: "Escape", code: "Escape" },
  esc: { key: "Escape", code: "Escape" },
  space: { key: " ", code: "Space" },
  up: { key: "ArrowUp", code: "ArrowUp" },
  arrowup: { key: "ArrowUp", code: "ArrowUp" },
  down: { key: "ArrowDown", code: "ArrowDown" },
  arrowdown: { key: "ArrowDown", code: "ArrowDown" },
  left: { key: "ArrowLeft", code: "ArrowLeft" },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft" },
  right: { key: "ArrowRight", code: "ArrowRight" },
  arrowright: { key: "ArrowRight", code: "ArrowRight" },
  home: { key: "Home", code: "Home" },
  end: { key: "End", code: "End" },
  page_down: { key: "PageDown", code: "PageDown" },
  pagedown: { key: "PageDown", code: "PageDown" },
  page_up: { key: "PageUp", code: "PageUp" },
  pageup: { key: "PageUp", code: "PageUp" },
  insert: { key: "Insert", code: "Insert" },
};

const MODIFIER_NAMES: Record<string, keyof Omit<KeyDescription, "key" | "code">> = {
  ctrl: "ctrlKey",
  control: "ctrlKey",
  shift: "shiftKey",
  alt: "altKey",
  option: "altKey",
  cmd: "metaKey",
  meta: "metaKey",
  super: "metaKey",
  win: "metaKey",
  windows: "metaKey",
};

function describeBaseKey(name: string): { key: string; code: string } {
  const named = NAMED_KEYS[name.toLowerCase()];
  if (named) return named;
  if (/^f([1-9]|1[0-2])$/i.test(name)) return { key: name.toUpperCase(), code: name.toUpperCase() };
  if (name.length === 1) return { key: name, code: codeForCharacter(name) };
  throw new Error(
    `unknown key "${name}": expected a single character, F1-F12 or one of ${Object.keys(NAMED_KEYS).join(", ")}`,
  );
}

function codeForCharacter(character: string): string {
  if (/[a-z]/i.test(character)) return `Key${character.toUpperCase()}`;
  if (/[0-9]/.test(character)) return `Digit${character}`;
  return "";
}

/**
 * Parse one key combo such as "ctrl+shift+Tab" or "Return".
 *
 * Example: parseKeyCombo("cmd+a") → { key: "a", code: "KeyA", metaKey: true, ... }
 */
export function parseKeyCombo(combo: string): KeyDescription {
  // A lone "+" is the plus character, not an empty combo.
  const parts = combo.length === 1 ? [combo] : combo.split("+").filter((part) => part.length > 0);
  const baseName = parts.pop();
  if (!baseName) throw new Error(`empty key combo "${combo}": expected e.g. "Return" or "ctrl+a"`);
  const description: KeyDescription = {
    ...describeBaseKey(baseName),
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  };
  for (const modifier of parts) applyModifier(description, modifier, combo);
  return description;
}

function applyModifier(description: KeyDescription, modifier: string, combo: string): void {
  const field = MODIFIER_NAMES[modifier.toLowerCase()];
  if (!field)
    throw new Error(
      `unknown modifier "${modifier}" in "${combo}": expected ctrl, shift, alt or cmd`,
    );
  description[field] = true;
}

/** Split a space-separated key sequence ("Backspace Backspace Delete") into combos. */
export function splitKeySequence(sequence: string): string[] {
  return sequence
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
}

/** Parse the `modifiers` click option ("ctrl+shift") into event-init flags. */
export function parseClickModifiers(
  modifiers: string | undefined,
): Omit<KeyDescription, "key" | "code"> {
  const flags = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  if (!modifiers) return flags;
  for (const modifier of modifiers.split("+")) {
    const field = MODIFIER_NAMES[modifier.trim().toLowerCase()];
    if (!field) throw new Error(`unknown modifier "${modifier}": expected ctrl, shift, alt or cmd`);
    flags[field] = true;
  }
  return flags;
}
