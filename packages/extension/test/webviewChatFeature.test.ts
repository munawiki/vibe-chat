// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@vscode-chat/protocol";
import type { UiInbound } from "../src/contract/protocol/index.js";
import type { VscodeWebviewApi, WebviewContext } from "../webview-src/app/types.js";
import {
  addMessage,
  bindChatUiEvents,
  isComposerSendKeydown,
  reclassifyMessages,
  renderGlobalConversation,
  renderHistory,
} from "../webview-src/features/chat.js";
import { createInitialWebviewState } from "../webview-src/state/webviewState.js";
import { getElements } from "../webview-src/dom/elements.js";

function setupDom(): void {
  document.body.innerHTML = `
    <div id="messages"></div>
    <textarea id="input"></textarea>
    <button id="btnSend"></button>
  `;
}

function createUser(options: {
  githubUserId: string;
  login: string;
  roles?: AuthUser["roles"];
}): AuthUser {
  return {
    githubUserId: options.githubUserId as import("@vscode-chat/protocol").GithubUserId,
    login: options.login,
    avatarUrl: `https://example.test/${options.login}.png`,
    roles: options.roles ?? [],
  };
}

describe("webview chat feature", () => {
  it("detects send keydowns", () => {
    expect(isComposerSendKeydown({ key: "Enter", code: "Enter", shiftKey: false })).toBe(true);
    expect(isComposerSendKeydown({ key: "Process", code: "Enter", shiftKey: false })).toBe(true);
    expect(isComposerSendKeydown({ key: "Process", code: "NumpadEnter", shiftKey: false })).toBe(
      true,
    );
    expect(isComposerSendKeydown({ key: "Enter", code: "Enter", shiftKey: true })).toBe(false);
  });

  it("renders message history with links and code blocks", () => {
    setupDom();

    const posted: UiInbound[] = [];
    const vscode: VscodeWebviewApi<UiInbound> = {
      postMessage: (m) => posted.push(m),
      getState: () => ({}),
      setState: () => {},
    };
    const state = createInitialWebviewState();
    state.auth.signedInLoginLowerCase = "alice";

    const ctx: WebviewContext = {
      vscode,
      els: getElements(),
      state,
      queueTask: queueMicrotask,
    };

    renderHistory(ctx, [
      {
        id: "m1",
        user: createUser({ githubUserId: "1", login: "alice", roles: ["moderator"] }),
        text: "Link: https://example.test\n\n```ts\nconst x = 1;\n```",
        createdAt: new Date().toISOString(),
      },
    ]);

    const own = document.querySelector(".messageRow.own");
    expect(own).toBeTruthy();

    const link = document.querySelector(".messageLink");
    expect(link).toBeInstanceOf(HTMLButtonElement);
    if (!(link instanceof HTMLButtonElement)) throw new Error("missing message link");

    expect(link.textContent).toContain("https://example.test");
    link.click();
    expect(posted.some((m) => m.type === "ui/link.open")).toBe(true);

    expect(document.querySelector(".msgCode")).toBeTruthy();
  });

  it("sends global messages via click and composition handling", async () => {
    setupDom();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-27T00:00:00.000Z"));

    const posted: UiInbound[] = [];
    const vscode: VscodeWebviewApi<UiInbound> = {
      postMessage: (m) => posted.push(m),
      getState: () => ({}),
      setState: () => {},
    };
    const state = createInitialWebviewState();
    state.auth.isConnected = true;
    state.channel.activeChannel = "global";

    const ctx: WebviewContext = {
      vscode,
      els: getElements(),
      state,
      queueTask: queueMicrotask,
    };

    bindChatUiEvents(ctx);

    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "hello";

    input.dispatchEvent(new CompositionEvent("compositionstart"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter" }));
    expect(posted.length).toBe(0);

    input.dispatchEvent(new CompositionEvent("compositionend"));

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter" }));
    expect(posted.length).toBe(0);

    await vi.runAllTimersAsync();
    expect(posted.some((m) => m.type === "ui/send")).toBe(true);
    expect(input.value).toBe("");

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not send on Shift+Enter and routes DM sends when a thread is selected", () => {
    setupDom();

    const posted: UiInbound[] = [];
    const vscode: VscodeWebviewApi<UiInbound> = {
      postMessage: (m) => posted.push(m),
      getState: () => ({}),
      setState: () => {},
    };
    const state = createInitialWebviewState();
    state.auth.isConnected = true;
    state.channel.activeChannel = "dm";
    state.channel.activeDmId = "dm:v1:1:2" as import("@vscode-chat/protocol").DmId;

    const ctx: WebviewContext = {
      vscode,
      els: getElements(),
      state,
      queueTask: queueMicrotask,
    };

    bindChatUiEvents(ctx);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "line 1";

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", shiftKey: true }),
    );
    expect(posted).toEqual([]);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter" }));
    const dmSend = posted.find(
      (m): m is Extract<UiInbound, { type: "ui/dm.send" }> => m.type === "ui/dm.send",
    );
    expect(dmSend).toEqual({
      type: "ui/dm.send",
      dmId: "dm:v1:1:2",
      text: "line 1",
    });
    expect(state.outbox).toEqual([]);
    expect(input.value).toBe("");
  });

  it("renders outbox states and language-hint variants for code blocks", () => {
    setupDom();

    const posted: UiInbound[] = [];
    const vscode: VscodeWebviewApi<UiInbound> = {
      postMessage: (m) => posted.push(m),
      getState: () => ({}),
      setState: () => {},
    };
    const state = createInitialWebviewState();
    state.auth.signedInLoginLowerCase = "alice";
    state.globalHistory = [
      {
        id: "g1",
        user: createUser({ githubUserId: "1", login: "alice" }),
        text: "seed",
        createdAt: "invalid-date",
      },
    ];
    state.outbox = [
      {
        clientMessageId: "11111111-1111-1111-1111-111111111111",
        text: "pending message",
        createdAt: new Date().toISOString(),
        phase: "pending",
      },
      {
        clientMessageId: "22222222-2222-2222-2222-222222222222",
        text: "failed message",
        createdAt: new Date().toISOString(),
        phase: "error",
        errorMessage: "  ",
      },
    ];

    const ctx: WebviewContext = {
      vscode,
      els: getElements(),
      state,
      queueTask: queueMicrotask,
    };

    renderGlobalConversation(ctx);
    expect(document.querySelector(".outboxRow.pending")?.textContent).toContain("Sending…");
    expect(document.querySelector(".outboxRow.failed")?.textContent).toContain("Failed");

    renderHistory(ctx, [
      {
        id: "m2",
        user: createUser({ githubUserId: "2", login: "bob" }),
        text: [
          "```typescript",
          "const a = 1;",
          "```",
          "```javascript",
          "const b = 2;",
          "```",
          "```sh",
          "echo hi",
          "```",
          "```yml",
          "k: v",
          "```",
          "```plaintext",
          "plain",
          "```",
          "```",
          "nohint",
          "```",
        ].join("\n"),
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(document.querySelectorAll(".msgCode").length).toBe(6);
  });

  it("guards no-op send paths and tolerates missing message containers", () => {
    setupDom();

    const posted: UiInbound[] = [];
    const vscode: VscodeWebviewApi<UiInbound> = {
      postMessage: (m) => posted.push(m),
      getState: () => ({}),
      setState: () => {},
    };
    const state = createInitialWebviewState();
    state.auth.isConnected = true;
    state.channel.activeChannel = "dm";

    const ctx: WebviewContext = {
      vscode,
      els: getElements(),
      state,
      queueTask: queueMicrotask,
    };

    bindChatUiEvents(ctx);
    const input = document.getElementById("input") as HTMLTextAreaElement;
    input.value = "hello";
    (document.getElementById("btnSend") as HTMLButtonElement).click();
    expect(posted).toEqual([]);

    state.channel.activeChannel = "global";
    input.value = "   ";
    (document.getElementById("btnSend") as HTMLButtonElement).click();
    expect(posted).toEqual([]);

    input.dispatchEvent(new CompositionEvent("compositionend"));
    expect(posted).toEqual([]);

    ctx.els.messages = null;
    reclassifyMessages(ctx);
    renderHistory(ctx, []);
    renderGlobalConversation(ctx);
    addMessage(ctx, {
      id: "m3",
      user: createUser({ githubUserId: "3", login: "carol" }),
      text: "ignored",
      createdAt: new Date().toISOString(),
    });
  });
});
