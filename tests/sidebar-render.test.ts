// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { SidebarSnapshot } from "../extension/src/shared/chat-protocol";
import { createConversation } from "../extension/src/shared/chat-transcript";
import { renderMarkdown } from "../extension/src/sidebar/markdown";
import {
  EMPTY_HINT,
  NOT_CONNECTED_STATUS,
  renderSidebar,
  summarizeToolInput,
} from "../extension/src/sidebar/render";

beforeEach(() => {
  document.documentElement.innerHTML = readFileSync("extension/sidebar.html", "utf8");
});

function snapshot(overrides: Partial<SidebarSnapshot> = {}): SidebarSnapshot {
  const conversation = createConversation("c1", "sonnet");
  return {
    conversation,
    conversations: [{ conversationId: "c1", title: "New chat", updatedAt: 1, busy: false }],
    hostConnected: true,
    ...overrides,
  };
}

describe("renderSidebar", () => {
  it("shows the empty hint, the model and the conversation picker on a new chat", () => {
    renderSidebar(document, snapshot());
    expect(document.querySelector("#messages .empty")!.textContent).toBe(EMPTY_HINT);
    expect((document.getElementById("model") as HTMLSelectElement).value).toBe("sonnet");
    expect((document.getElementById("conversations") as HTMLSelectElement).value).toBe("c1");
    expect(document.getElementById("status")!.textContent).toBe("New chat");
    expect((document.getElementById("send") as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById("stop")!.hidden).toBe(true);
  });
  it("renders user, streaming assistant markdown, tool lines, permission cards and errors", () => {
    const shot = snapshot();
    shot.conversation.busy = true;
    shot.conversation.items.push(
      { role: "user", text: "Summarise **this**" },
      {
        role: "assistant",
        text: "# Title\n\n- one `code`\n- [link](https://x.test/)",
        streaming: true,
      },
      {
        role: "tool",
        toolUseId: "t1",
        name: "mcp__claude-in-firefox__find",
        input: { query: "button" },
        resultText: "ref_3",
        isError: false,
      },
      { role: "tool", toolUseId: "t2", name: "Bash", input: { command: "ls" } },
      {
        role: "permission",
        requestId: "p1",
        toolName: "Write",
        input: { file_path: "/a" },
        description: "Write /a",
      },
      {
        role: "permission",
        requestId: "p0",
        toolName: "Bash",
        input: {},
        description: "",
        decision: "deny",
      },
      { role: "status", text: "boom", isError: true },
    );
    renderSidebar(document, shot);
    const messages = document.getElementById("messages")!;
    expect(messages.querySelector(".msg.user")!.textContent).toBe("Summarise **this**");
    const assistant = messages.querySelector(".msg.assistant.streaming")!;
    expect(assistant.querySelector("h1")!.textContent).toBe("Title");
    expect(assistant.querySelectorAll("li")).toHaveLength(2);
    expect(assistant.querySelector("code")!.textContent).toBe("code");
    expect(assistant.querySelector("a")!.getAttribute("target")).toBe("_blank");
    const tools = messages.querySelectorAll("details.tool summary");
    expect(tools[0]!.textContent).toBe("⚙ find query=button");
    expect(tools[1]!.textContent).toBe("⚙ Bash command=ls …");
    const buttons = messages.querySelectorAll<HTMLButtonElement>(".permission button");
    expect([...buttons].map((b) => `${b.dataset.requestId}:${b.dataset.allow}`)).toEqual([
      "p1:true",
      "p1:false",
    ]);
    expect(messages.querySelectorAll(".permission")[1]!.textContent).toContain("Denied");
    expect(messages.querySelector(".permission pre")!.textContent).toContain('"file_path": "/a"');
    expect(messages.querySelector(".permission")!.textContent).toContain("Write /a");
    expect(messages.querySelector(".status-line.error")!.textContent).toBe("boom");
    expect(document.getElementById("status")!.textContent).toBe("Claude is working…");
    expect((document.getElementById("send") as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById("stop")!.hidden).toBe(false);
  });
  it("explains a missing native host and disables sending", () => {
    renderSidebar(document, snapshot({ hostConnected: false }));
    expect(document.getElementById("status")!.textContent).toBe(NOT_CONNECTED_STATUS);
    expect((document.getElementById("send") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("summarizeToolInput", () => {
  it("picks the telling field and truncates", () => {
    expect(summarizeToolInput({ tabId: 1, action: "left_click", ref: "ref_2" })).toBe(
      "action=left_click",
    );
    expect(summarizeToolInput({ depth: 2 })).toBe('{"depth":2}');
    expect(summarizeToolInput({ text: "x".repeat(200) })).toMatch(/…$/);
    expect(summarizeToolInput("nope")).toBe("");
  });
});

describe("renderMarkdown", () => {
  it("keeps fenced code verbatim and never injects HTML", () => {
    const fragment = renderMarkdown(
      document,
      "Before <b>x</b>\n\n```js\nconst a = 1;\n```\n\n1. first\n2. second",
    );
    const container = document.createElement("div");
    container.append(fragment);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("p")!.textContent).toBe("Before <b>x</b>");
    expect(container.querySelector("pre")!.textContent).toBe("const a = 1;");
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });
});
