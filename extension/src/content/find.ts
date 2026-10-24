import { flatElementLines } from "./accessibility-tree";
import type { FindMatch } from "../shared/protocol";

const MAX_MATCHES = 20;

/**
 * Case-insensitive substring search over every element line of the page.
 *
 * Example: findElements("sign in") → [{ ref: "ref_7", line: 'button "Sign in" [ref_7]' }]
 */
export function findElements(query: string): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle)
    throw new Error(`empty find query: expected text that appears in a role, name or label`);
  const matches: FindMatch[] = [];
  for (const line of flatElementLines()) {
    if (!line.toLowerCase().includes(needle)) continue;
    const ref = /\[(ref_\d+)\]/.exec(line)?.[1];
    if (ref) matches.push({ ref, line });
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches;
}
