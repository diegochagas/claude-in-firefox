/** Splits a stream of chunks into complete newline-terminated lines. */
export class LineReader {
  private partial = "";

  feed(chunk: string): string[] {
    const pieces = (this.partial + chunk).split("\n");
    this.partial = pieces.pop() ?? "";
    return pieces.filter((line) => line.trim().length > 0);
  }
}
