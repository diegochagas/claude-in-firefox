/** Fixed-capacity per-tab log: newest entries win, closed tabs are forgotten. */
export class PerTabRingBuffer<T> {
  private readonly entriesByTab = new Map<number, T[]>();

  constructor(private readonly capacity: number) {}

  push(tabId: number, entry: T): void {
    const entries = this.entriesByTab.get(tabId) ?? [];
    entries.push(entry);
    if (entries.length > this.capacity) entries.splice(0, entries.length - this.capacity);
    this.entriesByTab.set(tabId, entries);
  }

  list(tabId: number): T[] {
    return [...(this.entriesByTab.get(tabId) ?? [])];
  }

  clear(tabId: number): void {
    this.entriesByTab.delete(tabId);
  }
}
