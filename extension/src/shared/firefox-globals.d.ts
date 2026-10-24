// Firefox-only content-script globals (Xray wrappers). See
// https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts
interface Window {
  wrappedJSObject: Window & Record<string, unknown>;
}

interface Element {
  checkVisibility?(options?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }): boolean;
}

declare function exportFunction<T extends (...args: never[]) => unknown>(
  func: T,
  targetScope: object,
  options?: { defineAs?: string; allowCrossOriginArguments?: boolean },
): T;
