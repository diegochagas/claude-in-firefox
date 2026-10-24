// Tabs a bridge request has addressed. Response bodies are captured only for these, so the
// extension does not stream every XHR of the user's normal browsing through itself.
const drivenTabIds = new Set<number>();

export function markTabDriven(tabId: number): void {
  drivenTabIds.add(tabId);
}

export function isTabDriven(tabId: number): boolean {
  return drivenTabIds.has(tabId);
}

export function forgetDrivenTab(tabId: number): void {
  drivenTabIds.delete(tabId);
}
