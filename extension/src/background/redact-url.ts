// Whole-word match on the last segment of the name ("api_key", "x-auth-token", "sessionId"),
// so "keyword", "author" or "monkey" stay visible (code review, 2026-10-24).
const SENSITIVE_PARAM =
  /(^|[_-])(api[_-]?key|key|token|auth|authorization|secret|password|passwd|pass|session|sessionid|sig|signature|credentials?)$/i;

/**
 * Hide credential-looking query values before a URL reaches the model.
 *
 * Example: redactUrl("https://x.test/a?api_key=123&page=2") → "https://x.test/a?api_key=REDACTED&page=2"
 */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  const [query, hash] = url.slice(queryStart + 1).split("#", 2);
  const redacted = (query ?? "")
    .split("&")
    .map((pair) => {
      const [name] = pair.split("=", 1);
      return name && SENSITIVE_PARAM.test(name) ? `${name}=REDACTED` : pair;
    })
    .join("&");
  return `${url.slice(0, queryStart)}?${redacted}${hash !== undefined ? `#${hash}` : ""}`;
}
