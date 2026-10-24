// Translates one line of `claude -p --output-format stream-json --include-partial-messages`
// into ChatEvents. Shapes observed with Claude Code 2.1 (2026-10-24): system/init,
// stream_event (Anthropic API deltas), assistant/user messages with content blocks,
// control_request (permission prompts when --permission-prompt-tool stdio), result.
import type { ChatEvent, ChatImage } from "../../extension/src/shared/chat-protocol";

export const TOOL_RESULT_MAX_CHARS = 600;
/**
 * Native messaging refuses frames above 1 MiB on the way to the extension; one event carries
 * at most this much base64 (a half-scale screenshot is ~350 KB, a full one can be over 1 MB).
 */
export const IMAGE_MAX_BASE64_CHARS = 700_000;

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
  source?: { type?: string; media_type?: string; data?: string };
}

interface ClaudeStreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  message?: { content?: string | ContentBlock[] };
  request_id?: string;
  request?: { subtype?: string; tool_name?: string; input?: unknown; description?: string };
  is_error?: boolean;
  result?: string;
  duration_ms?: number;
  total_cost_usd?: number;
}

function blocksOf(content: string | ContentBlock[] | undefined): ContentBlock[] {
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

/** Flatten a tool result's content to display text, truncated with an explicit note. */
export function toolResultText(content: string | ContentBlock[] | undefined): string {
  const text = blocksOf(content)
    .map((block) => (block.type === "text" ? (block.text ?? "") : `[${block.type}]`))
    .join("\n")
    .trim();
  if (text.length <= TOOL_RESULT_MAX_CHARS) return text;
  return `${text.slice(0, TOOL_RESULT_MAX_CHARS)}… [truncated, ${text.length} chars]`;
}

function fromAssistant(line: ClaudeStreamLine): ChatEvent[] {
  return blocksOf(line.message?.content).flatMap((block): ChatEvent[] => {
    if (block.type === "text") return [{ type: "assistant_text", text: block.text ?? "" }];
    if (block.type === "tool_use")
      return [
        {
          type: "tool_use",
          toolUseId: block.id ?? "",
          name: block.name ?? "?",
          input: block.input,
        },
      ];
    return [];
  });
}

/**
 * Images of a tool result that fit the frame budget, and a note for every one that does not.
 * Example: toolResultImages([{ type: "image", source: { media_type: "image/png", data: "iVBOR…" } }])
 */
export function toolResultImages(content: string | ContentBlock[] | undefined): {
  images: ChatImage[];
  omitted: string[];
} {
  const images: ChatImage[] = [];
  const omitted: string[] = [];
  let budget = IMAGE_MAX_BASE64_CHARS;
  for (const block of blocksOf(content)) {
    const base64 = block.type === "image" ? block.source?.data : undefined;
    if (!base64) continue;
    if (base64.length > budget) {
      omitted.push(omittedImageNote(base64.length));
      continue;
    }
    budget -= base64.length;
    images.push({ mediaType: block.source?.media_type ?? "image/png", base64 });
  }
  return { images, omitted };
}

function omittedImageNote(base64Length: number): string {
  return `[image of ${Math.round(base64Length / 1024)} KB not shown: over the sidebar's size limit]`;
}

function fromToolResult(block: ContentBlock): ChatEvent {
  const { images, omitted } = toolResultImages(block.content);
  const text = [toolResultText(block.content), ...omitted].filter(Boolean).join("\n");
  const event: ChatEvent = {
    type: "tool_result",
    toolUseId: block.tool_use_id ?? "",
    text,
    isError: block.is_error === true,
  };
  if (images.length > 0) event.images = images;
  return event;
}

function fromUser(line: ClaudeStreamLine): ChatEvent[] {
  return blocksOf(line.message?.content)
    .filter((block) => block.type === "tool_result")
    .map(fromToolResult);
}

function fromControlRequest(line: ClaudeStreamLine): ChatEvent[] {
  if (line.request?.subtype !== "can_use_tool" || !line.request_id) return [];
  return [
    {
      type: "permission",
      requestId: line.request_id,
      toolName: line.request.tool_name ?? "?",
      input: line.request.input,
      description: line.request.description ?? "",
    },
  ];
}

function fromResult(line: ClaudeStreamLine): ChatEvent[] {
  const isError =
    line.is_error === true || (line.subtype !== undefined && line.subtype !== "success");
  return [
    {
      type: "turn_end",
      isError,
      resultText: line.result ?? line.subtype ?? "",
      durationMs: line.duration_ms ?? 0,
      costUsd: line.total_cost_usd ?? 0,
    },
  ];
}

function fromSystem(line: ClaudeStreamLine): ChatEvent[] {
  if (line.subtype !== "init") return [];
  return [{ type: "session", sessionId: line.session_id ?? "", model: line.model ?? "" }];
}

function fromStreamEvent(line: ClaudeStreamLine): ChatEvent[] {
  const delta = line.event?.delta;
  if (line.event?.type !== "content_block_delta" || delta?.type !== "text_delta") return [];
  return [{ type: "text", delta: delta.text ?? "" }];
}

const TRANSLATORS: Record<string, (line: ClaudeStreamLine) => ChatEvent[]> = {
  system: fromSystem,
  stream_event: fromStreamEvent,
  assistant: fromAssistant,
  user: fromUser,
  control_request: fromControlRequest,
  result: fromResult,
};

/**
 * Events for one stdout line; non-JSON lines and unknown message types yield none.
 * Example: translateClaudeLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}')
 *   → [{ type: "text", delta: "Hi" }]
 */
export function translateClaudeLine(line: string): ChatEvent[] {
  let parsed: ClaudeStreamLine;
  try {
    parsed = JSON.parse(line) as ClaudeStreamLine;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  return TRANSLATORS[parsed.type ?? ""]?.(parsed) ?? [];
}
