// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { AuthUser } from "@vscode-chat/protocol";
import type { ExtState, UiInbound } from "../src/contract/protocol/index.js";
import type { VscodeWebviewApi, WebviewContext } from "../webview-src/app/types.js";
import { getElements } from "../webview-src/dom/elements.js";
import { renderComposer } from "../webview-src/app/renderComposer.js";
import {
  renderChannelTabs,
  renderConversation,
  renderDmPanel,
  renderDmWarning,
} from "../webview-src/app/renderDm.js";
import { renderState, setError } from "../webview-src/app/render.js";
import { createInitialWebviewState } from "../webview-src/state/webviewState.js";

function setupDom(): void {
  document.body.innerHTML = `
    <button id="btnChannelGlobal"></button>
    <button id="btnChannelDm"></button>
    <div id="dmPanel">
      <div id="dmWarning" hidden>
        <span id="dmWarningText"></span>
        <button id="btnDmTrust" hidden></button>
      </div>
      <div id="dmThreads"></div>
      <div id="dmEmpty" hidden></div>
    </div>

    <button id="btnConnStatus"></button>
    <span id="connDot"></span>
    <span id="connText"></span>

    <button id="btnIdentity" hidden></button>
    <img id="identityAvatar" />
    <span id="identityLogin"></span>

    <button id="btnSignIn"></button>
    <button id="btnReconnect"></button>

    <div id="messages"></div>
    <textarea id="input"></textarea>
    <button id="btnSend"></button>

    <div id="error"></div>
  `;
}

function createUser(options: { githubUserId: string; login: string }): AuthUser {
  return {
    githubUserId: options.githubUserId as import("@vscode-chat/protocol").GithubUserId,
    login: options.login,
    avatarUrl: `https://example.test/${options.login}.png`,
    roles: [],
  };
}

function createCtx(posted: UiInbound[]): WebviewContext {
  const vscode: VscodeWebviewApi<UiInbound> = {
    postMessage: (m) => posted.push(m),
    getState: () => ({}),
    setState: () => {},
  };
  return {
    vscode,
    els: getElements(),
    state: createInitialWebviewState(),
    queueTask: queueMicrotask,
  };
}

function createActions(): ExtState["actions"] {
  return {
    signIn: { visible: true, enabled: true, label: "Sign in" },
    connect: { visible: true, enabled: true, label: "Reconnect" },
  };
}

describe("webview render state", () => {
  it("marks pending outbox entries as errors when connection drops", () => {
    setupDom();
    const posted: UiInbound[] = [];
    const ctx = createCtx(posted);
    ctx.state.auth.isConnected = true;
    ctx.state.channel.activeChannel = "global";
    ctx.state.outbox.push({
      clientMessageId: "11111111-1111-1111-1111-111111111111",
      text: "pending",
      createdAt: new Date().toISOString(),
      phase: "pending",
    });

    renderState(ctx, {
      authStatus: "signedIn",
      status: "disconnected",
      backendUrl: "https://example.test",
      user: createUser({ githubUserId: "1", login: "alice" }),
      actions: createActions(),
    });

    expect(ctx.state.outbox[0]?.phase).toBe("error");
    expect(ctx.state.outbox[0]?.errorMessage).toBe("Not connected.");
    expect(document.querySelector(".outboxRow.failed")).toBeTruthy();
    expect(document.getElementById("connText")?.textContent).toBe("Disconnected");
    expect((document.getElementById("btnSend") as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById("input") as HTMLTextAreaElement).disabled).toBe(true);

    renderState(ctx, {
      authStatus: "signedOut",
      status: undefined,
      actions: createActions(),
    } as unknown as ExtState);
    expect(document.getElementById("connText")?.textContent).toBe("Unknown");
    expect((document.getElementById("btnIdentity") as HTMLButtonElement).hidden).toBe(true);
  });

  it("renders DM placeholders and thread-selection callback flow", () => {
    setupDom();
    const posted: UiInbound[] = [];
    const ctx = createCtx(posted);
    ctx.state.auth.isConnected = true;
    ctx.state.channel.activeChannel = "dm";

    renderChannelTabs(ctx);
    renderDmPanel(ctx);
    renderConversation(ctx);
    renderComposer(ctx);
    expect(document.getElementById("messages")?.textContent).toContain("No DMs yet.");
    expect((document.getElementById("input") as HTMLTextAreaElement).placeholder).toBe(
      "Select a DM thread…",
    );

    ctx.state.channel.dmThreads = [
      {
        dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
        peer: createUser({ githubUserId: "2", login: "bob" }),
        isBlocked: true,
        canTrustKey: true,
        warning: "Untrusted key",
      },
    ];

    renderDmPanel(ctx);
    renderConversation(ctx);
    expect(document.getElementById("messages")?.textContent).toContain("Select a DM thread.");

    const threadButton = document.querySelector(".dmThread") as HTMLButtonElement;
    threadButton.click();
    expect(posted.some((m) => m.type === "ui/dm.thread.select" && m.dmId === "dm:v1:1:2")).toBe(
      true,
    );
    expect((document.getElementById("input") as HTMLTextAreaElement).placeholder).toBe(
      "DM blocked until trusted…",
    );
    expect((document.getElementById("dmWarning") as HTMLElement).hidden).toBe(false);
    expect((document.getElementById("btnDmTrust") as HTMLButtonElement).hidden).toBe(false);

    ctx.state.channel.dmThreads[0] = {
      ...ctx.state.channel.dmThreads[0],
      isBlocked: false,
      canTrustKey: false,
      warning: undefined,
    };
    renderDmWarning(ctx);
    expect((document.getElementById("dmWarning") as HTMLElement).hidden).toBe(true);

    ctx.state.channel.activeDmId = "dm:v1:missing" as import("@vscode-chat/protocol").DmId;
    renderComposer(ctx);
    expect((document.getElementById("input") as HTMLTextAreaElement).placeholder).toBe(
      "Message @user…",
    );
  });

  it("sets and clears error text", () => {
    setupDom();
    const posted: UiInbound[] = [];
    const ctx = createCtx(posted);

    setError(ctx, "Boom");
    expect(document.getElementById("error")?.classList.contains("visible")).toBe(true);
    expect(document.getElementById("error")?.textContent).toBe("Boom");

    setError(ctx, "");
    expect(document.getElementById("error")?.classList.contains("visible")).toBe(false);
    expect(document.getElementById("error")?.textContent).toBe("");

    document.getElementById("error")?.remove();
    setError(ctx, "ignored");
  });

  it("tolerates missing element handles and undefined action config", () => {
    setupDom();
    const posted: UiInbound[] = [];
    const ctx = createCtx(posted);

    ctx.els.signIn = null;
    ctx.els.reconnect = null;
    ctx.els.channelGlobal = null;
    ctx.els.channelDm = null;
    ctx.els.dmPanel = null;
    ctx.els.dmWarning = null;
    ctx.els.dmWarningText = null;
    ctx.els.dmTrust = null;
    ctx.els.dmThreads = null;
    ctx.els.dmEmpty = null;
    ctx.els.messages = null;
    ctx.els.send = null;
    ctx.els.input = null;
    ctx.els.connButton = null;
    ctx.els.connText = null;
    ctx.els.identity = null;
    ctx.els.identityLogin = null;
    ctx.els.identityAvatar = null;
    ctx.els.error = null;

    renderState(ctx, {
      authStatus: "signedOut",
      status: "disconnected",
      actions: undefined,
    } as unknown as ExtState);

    renderChannelTabs(ctx);
    renderDmPanel(ctx);
    renderConversation(ctx);
    renderComposer(ctx);
    renderDmWarning(ctx);
    setError(ctx, "ignored");
  });
});
