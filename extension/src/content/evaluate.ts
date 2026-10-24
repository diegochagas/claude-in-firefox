// javascript_tool: evaluates code in the page's own JavaScript world (window.wrappedJSObject),
// so page globals are visible, with REPL semantics (top-level await, last expression returned).
// Pages whose CSP forbids eval fall back to the content-script world, which sees the DOM but
// not page-defined globals.

const EVALUATION_TIMEOUT_MS = 30_000;
const MAX_RESULT_CHARS = 50_000;

interface EvaluationOutcome {
  value?: unknown;
  error?: string;
  world: "page" | "content-script";
}

function wrapAsExpression(code: string): string {
  return `(async () => (\n${code}\n))()`;
}

function wrapAsStatements(code: string): string {
  return `(async () => {\n${code}\n})()`;
}

/** "const x = 1; x + 41" → "const x = 1; return (x + 41)", so the last statement's value comes back. */
function wrapReturningLast(code: string): string | undefined {
  const trimmed = code.trim().replace(/;+\s*$/, "");
  const boundary = Math.max(trimmed.lastIndexOf(";"), trimmed.lastIndexOf("\n"));
  if (boundary === -1) return undefined;
  const head = trimmed.slice(0, boundary + 1);
  const tail = trimmed.slice(boundary + 1).trim();
  if (!tail || /^(const|let|var|if|for|while|return|function|class|}|\/\/)/.test(tail))
    return undefined;
  return `(async () => {\n${head}\nreturn (\n${tail}\n);\n})()`;
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError || String(error).indexOf("SyntaxError") !== -1;
}

function evaluateIn(evaluator: (source: string) => unknown, code: string): unknown {
  const attempts = [wrapAsExpression(code), wrapReturningLast(code), wrapAsStatements(code)];
  let lastError: unknown;
  for (const source of attempts) {
    if (source === undefined) continue;
    try {
      return evaluator(source);
    } catch (error) {
      if (!isSyntaxError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function pageEvaluator(): (source: string) => unknown {
  const pageWindow = window.wrappedJSObject;
  const pageEval = pageWindow.eval as (source: string) => unknown;
  return (source) => pageEval(source);
}

function isCspBlocked(error: unknown): boolean {
  const text = String(error);
  return /EvalError|call to eval\(\) blocked|unsafe-eval|Content.Security.Policy/i.test(text);
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`evaluation exceeded ${EVALUATION_TIMEOUT_MS / 1000}s`)),
      EVALUATION_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]);
}

function serialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "function") return String(value);
  if (value instanceof Error)
    return JSON.stringify({ name: value.name, message: value.message, stack: value.stack });
  const seen = new WeakSet<object>();
  const json = JSON.stringify(value, (_key, item) => replaceCycles(item, seen), 2);
  const text = json ?? String(value);
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated: ${text.length - MAX_RESULT_CHARS} more characters]`
    : text;
}

function replaceCycles(item: unknown, seen: WeakSet<object>): unknown {
  if (typeof item === "bigint") return `${item}n`;
  if (typeof item !== "object" || item === null) return item;
  if (seen.has(item)) return "[Circular]";
  seen.add(item);
  if (item instanceof Node) return `[${(item as Element).tagName ?? item.nodeName}]`;
  return item;
}

async function runInWorld(
  world: EvaluationOutcome["world"],
  code: string,
): Promise<EvaluationOutcome> {
  const evaluator = world === "page" ? pageEvaluator() : (source: string) => window.eval(source);
  try {
    const value = await withTimeout(Promise.resolve(evaluateIn(evaluator, code)));
    return { value, world };
  } catch (error) {
    return {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      world,
    };
  }
}

/**
 * Evaluate code the way a DevTools console would and return a text rendering of the result.
 *
 * Example: evaluateOnPage("document.title") → '"Example Domain"'
 */
export async function evaluateOnPage(code: string): Promise<string> {
  let outcome = await runInWorld("page", code);
  if (outcome.error && isCspBlocked(outcome.error)) {
    outcome = await runInWorld("content-script", code);
    outcome.world = "content-script";
  }
  if (outcome.error) return `Error: ${outcome.error}`;
  const note =
    outcome.world === "content-script"
      ? "\n[page CSP blocks eval: ran in the extension's content-script world, page globals are not visible]"
      : "";
  return serialize(outcome.value) + note;
}
