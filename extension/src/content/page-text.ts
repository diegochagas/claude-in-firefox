// get_page_text: the readable text of the page, main content first.

const MIN_MAIN_LENGTH = 200;

function mainContentText(): string {
  const main = document.querySelector("article, main, [role=main]") as HTMLElement | null;
  const text = main?.innerText?.trim() ?? "";
  return text.length >= MIN_MAIN_LENGTH ? text : "";
}

/** Visible text of the page, capped at maxChars with a truncation note. */
export function pageText(maxChars: number): string {
  const text = (mainContentText() || document.body?.innerText || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated: ${text.length - maxChars} more characters]`;
}

export function viewportInfo() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    devicePixelRatio: window.devicePixelRatio,
  };
}
