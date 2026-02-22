// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { AuthUser } from "@vscode-chat/protocol";
import type { UiInbound } from "../src/contract/webviewProtocol.js";
import type { VscodeWebviewApi, WebviewContext } from "../webview-src/app/types.js";
import { dispatchExtOutbound } from "../webview-src/app/extRouter.js";
import { getElements } from "../webview-src/dom/elements.js";
import { createInitialWebviewState } from "../webview-src/state/webviewState.js";

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

describe("extRouter outbox reconciliation", () => {
  it("settles outbox on matching ext/message and ignores late send errors", () => {
    setupDom();

    const vscode: VscodeWebviewApi<UiInbound> = {
      postMessage: () => {},
      getState: () => ({}),
      setState: () => {},
    };
    const state = createInitialWebviewState();
    state.activeChannel = "global";
    state.isConnected = true;
    state.outbox.push({
      clientMessageId: "client-1",
      text: "hello",
      createdAt: new Date().toISOString(),
      phase: "pending",
    });

    const ctx: WebviewContext = {
      vscode,
      els: getElements(),
      state,
      queueTask: queueMicrotask,
    };

    const message = {
      id: "m1",
      user: createUser({ githubUserId: "1", login: "alice" }),
      text: "hello",
      createdAt: new Date().toISOString(),
    };

    dispatchExtOutbound(ctx, { type: "ext/message", message, clientMessageId: "client-1" });
    expect(state.outbox).toEqual([]);
    expect(state.settledClientMessageIds.has("client-1")).toBe(true);
    expect(state.globalHistory).toHaveLength(1);

    dispatchExtOutbound(ctx, { type: "ext/message", message, clientMessageId: "client-1" });
    expect(state.globalHistory).toHaveLength(1);

    dispatchExtOutbound(ctx, {
      type: "ext/message.send.error",
      clientMessageId: "client-1",
      code: "invalid_payload",
      message: "ignored",
    });
    expect(state.outbox).toEqual([]);
  });

  it("resets outbox and settled ids on ext/history", () => {
    setupDom();

    const vscode: VscodeWebviewApi<UiInbound> = {
      postMessage: () => {},
      getState: () => ({}),
      setState: () => {},
    };
    const state = createInitialWebviewState();
    state.activeChannel = "global";
    state.isConnected = true;
    state.outbox.push({
      clientMessageId: "client-2",
      text: "pending",
      createdAt: new Date().toISOString(),
      phase: "pending",
    });
    state.settledClientMessageIds.add("client-3");

    const ctx: WebviewContext = {
      vscode,
      els: getElements(),
      state,
      queueTask: queueMicrotask,
    };

    dispatchExtOutbound(ctx, { type: "ext/history", history: [] });
    expect(state.outbox).toEqual([]);
    expect(state.settledClientMessageIds.size).toBe(0);
  });
});
