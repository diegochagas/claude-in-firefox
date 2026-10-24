// Content script entry: receives commands from the background and runs them on this document.
import type { ContentCommand } from "../shared/protocol";
import { joinWithLimit, outlineLines } from "./accessibility-tree";
import { installConsoleHook } from "./console-hook";
import { evaluateOnPage } from "./evaluate";
import { findElements } from "./find";
import { setFormValue } from "./form-input";
import { performKeyboardAction } from "./keyboard";
import { pageText, viewportInfo } from "./page-text";
import { performPointerAction } from "./pointer";
import { scrollAtPoint, scrollToRef } from "./scroll";

type CommandOf<K extends ContentCommand["kind"]> = Extract<ContentCommand, { kind: K }>;
type Runner = { [K in ContentCommand["kind"]]: (command: CommandOf<K>) => unknown };

const RUNNERS: Runner = {
  pointer: performPointerAction,
  keyboard: performKeyboardAction,
  scroll: scrollAtPoint,
  scrollTo: (command) => scrollToRef(command.ref),
  read: (command) => joinWithLimit(outlineLines(command), command.maxChars),
  find: (command) => findElements(command.query),
  text: (command) => pageText(command.maxChars),
  formInput: (command) => setFormValue(command.ref, command.value),
  evaluate: (command) => evaluateOnPage(command.code),
  viewport: viewportInfo,
};

async function runContentCommand(command: ContentCommand): Promise<unknown> {
  const runner = RUNNERS[command.kind] as (command: ContentCommand) => unknown;
  if (!runner)
    throw new Error(
      `unknown content command "${command.kind}": expected one of ${Object.keys(RUNNERS).join(", ")}`,
    );
  return runner(command);
}

function isContentCommand(message: unknown): message is ContentCommand {
  return (
    typeof message === "object" &&
    message !== null &&
    typeof (message as ContentCommand).kind === "string"
  );
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (!isContentCommand(message)) return undefined;
  return runContentCommand(message).catch((error: unknown) => {
    throw new Error(error instanceof Error ? error.message : String(error));
  });
});

installConsoleHook();
