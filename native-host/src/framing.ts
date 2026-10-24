// Native messaging framing: each message is a 32-bit little-endian byte length followed by
// UTF-8 JSON. https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Native_messaging

const HEADER_BYTES = 4;
/** Firefox rejects messages to the extension above 1 MiB; the other direction allows 4 GiB. */
export const MAX_MESSAGE_TO_EXTENSION_BYTES = 1024 * 1024;

export function encodeNativeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Incremental decoder: feed stdin chunks, get every complete message back. */
export class NativeMessageDecoder {
  private buffered: Buffer = Buffer.alloc(0);

  feed(chunk: Buffer): unknown[] {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    const messages: unknown[] = [];
    let next = this.takeOne();
    while (next !== undefined) {
      messages.push(next);
      next = this.takeOne();
    }
    return messages;
  }

  private takeOne(): unknown | undefined {
    if (this.buffered.length < HEADER_BYTES) return undefined;
    const length = this.buffered.readUInt32LE(0);
    if (this.buffered.length < HEADER_BYTES + length) return undefined;
    const body = this.buffered.subarray(HEADER_BYTES, HEADER_BYTES + length).toString("utf8");
    this.buffered = this.buffered.subarray(HEADER_BYTES + length);
    return JSON.parse(body);
  }
}
