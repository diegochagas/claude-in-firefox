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

  /** Mutate the stored entry matching predicate in place; false when none matches. */
  update(tabId: number, predicate: (entry: T) => boolean, patch: (entry: T) => void): boolean {
    const entry = this.entriesByTab.get(tabId)?.find(predicate);
    if (!entry) return false;
    patch(entry);
    return true;
  }

  clear(tabId: number): void {
    this.entriesByTab.delete(tabId);
  }
}
