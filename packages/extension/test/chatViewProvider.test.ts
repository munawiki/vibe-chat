import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "@vscode-chat/protocol";
import type { ChatMessagePlain, ServerEvent } from "@vscode-chat/protocol";
import type { ExtOutbound, UiInbound } from "../src/contract/webviewProtocol.js";
import { createExtensionBus, type ExtensionBus } from "../src/bus/extensionBus.js";

type UriLike = Readonly<{ path: string; toString: () => string }>;
const makeUri = (path: string): UriLike => ({ path, toString: () => path });

const configHarness = vi.hoisted(() => ({
  backendUrl: "http://example.test",
  autoConnect: false,
}));

vi.mock("vscode", () => ({
  ExtensionMode: { Development: 1, Production: 2 },
  Uri: {
    parse: (value: string) => makeUri(value),
    joinPath: (base: UriLike, ...parts: string[]) => makeUri([base.path, ...parts].join("/")),
  },
}));

vi.mock("../src/ui/chatView/config.js", () => ({
  getBackendUrlFromConfig: () => configHarness.backendUrl,
  isAutoConnectEnabledFromConfig: () => configHarness.autoConnect,
}));

const externalHarness = vi.hoisted(() => ({
  openExternalHref: vi.fn(() => Promise.resolve({ ok: true as const })),
  openGitHubProfileInBrowser: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock("../src/ui/chatView/external.js", () => ({
  openExternalHref: (href: string) => externalHarness.openExternalHref(href),
  openGitHubProfileInBrowser: (login: string) => externalHarness.openGitHubProfileInBrowser(login),
}));

const profileHarness = vi.hoisted(() => ({
  fetchProfileMessage: vi.fn(() =>
    Promise.resolve({ type: "ext/profile.result", login: "x", profile: {} }),
  ),
}));

vi.mock("../src/ui/chatView/profile.js", () => ({
  fetchProfileMessage: (service: unknown, login: string) =>
    profileHarness.fetchProfileMessage(service, login),
}));

const moderationHarness = vi.hoisted(() => ({
  snapshot: {
    type: "ext/moderation.snapshot",
    operatorDeniedGithubUserIds: [],
    roomDeniedGithubUserIds: [],
  },
  includeSend: true,
  snapshotMessage: {
    type: "ext/moderation.snapshot",
    operatorDeniedGithubUserIds: [],
    roomDeniedGithubUserIds: [],
  } as ExtOutbound | undefined,
}));

vi.mock("../src/ui/chatView/moderation.js", () => ({
  ChatViewModeration: class {
    reset(): void {
      // no-op
    }
    handleUiAction(
      action: "deny" | "allow",
      targetGithubUserId: string,
    ): { outbound: ExtOutbound; send?: { action: "deny" | "allow"; targetGithubUserId: string } } {
      return {
        outbound: { type: "ext/moderation.action", action, phase: "pending", targetGithubUserId },
        ...(moderationHarness.includeSend ? { send: { action, targetGithubUserId } } : {}),
      };
    }
    handleServerSnapshot(): ExtOutbound {
      return moderationHarness.snapshot as unknown as ExtOutbound;
    }
    handleServerUserDenied(): { userMessage: ExtOutbound; resolved?: ExtOutbound } {
      return {
        userMessage: {
          type: "ext/moderation.user.denied",
          targetGithubUserId: "x",
          actorGithubUserId: "y",
        } as unknown as ExtOutbound,
      };
    }
    handleServerUserAllowed(): { userMessage: ExtOutbound; resolved?: ExtOutbound } {
      return {
        userMessage: {
          type: "ext/moderation.user.allowed",
          targetGithubUserId: "x",
          actorGithubUserId: "y",
        } as unknown as ExtOutbound,
      };
    }
    handleServerError(): ExtOutbound | undefined {
      return {
        type: "ext/moderation.action",
        action: "deny",
        phase: "error",
        targetGithubUserId: "x",
        message: "forbidden",
      } as unknown as ExtOutbound;
    }
    getSnapshotMessage(): ExtOutbound | undefined {
      return moderationHarness.snapshotMessage as unknown as ExtOutbound | undefined;
    }
  },
}));

const dmHarness = vi.hoisted(() => ({
  openCalls: 0,
  threadSelectCalls: 0,
  sendCalls: 0,
  trustCalls: 0,
  resetAccountStateCalls: 0,
  ensureIdentityError: undefined as string | undefined,
  openError: undefined as string | undefined,
  threadSelectError: undefined as string | undefined,
  sendError: undefined as string | undefined,
  trustMessage: undefined as ExtOutbound | undefined,
  serverWelcomeCalls: 0,
  serverWelcomeDelay: undefined as Promise<void> | undefined,
  serverWelcomeAdditional: undefined as ExtOutbound | undefined,
  serverWelcomeError: undefined as string | undefined,
}));

vi.mock("../src/ui/chatView/directMessages.js", () => ({
  ChatViewDirectMessages: class {
    reset(): void {
      // no-op
    }
    resetAccountState(): void {
      dmHarness.resetAccountStateCalls += 1;
    }
    getStateMessage(): ExtOutbound {
      return { type: "ext/dm.state", threads: [] };
    }
    ensureIdentityPublished(): Promise<void> {
      if (dmHarness.ensureIdentityError) {
        return Promise.reject(new Error(dmHarness.ensureIdentityError));
      }
      return Promise.resolve();
    }
    handleUiOpen(): string | undefined {
      dmHarness.openCalls += 1;
      return dmHarness.openError;
    }
    handleUiThreadSelect(): string | undefined {
      dmHarness.threadSelectCalls += 1;
      return dmHarness.threadSelectError;
    }
    handleUiSend(): Promise<string | undefined> {
      dmHarness.sendCalls += 1;
      return Promise.resolve(dmHarness.sendError);
    }
    handleUiTrustPeerKey(): Promise<ExtOutbound | undefined> {
      dmHarness.trustCalls += 1;
      return Promise.resolve(dmHarness.trustMessage);
    }
    handleServerWelcome(): Promise<{
      outbound: ExtOutbound[];
      history: ExtOutbound | undefined;
      error: string | undefined;
    }> {
      dmHarness.serverWelcomeCalls += 1;
      if (dmHarness.serverWelcomeDelay) {
        return dmHarness.serverWelcomeDelay.then(() => ({
          outbound: [{ type: "ext/dm.state", threads: [] }],
          history: dmHarness.serverWelcomeAdditional,
          error: dmHarness.serverWelcomeError,
        }));
      }
      return Promise.resolve({
        outbound: [{ type: "ext/dm.state", threads: [] }],
        history: dmHarness.serverWelcomeAdditional,
        error: dmHarness.serverWelcomeError,
      });
    }
    handleServerMessageNew(): Promise<{
      outbound: ExtOutbound[];
      message: ExtOutbound | undefined;
      error: string | undefined;
    }> {
      return Promise.resolve({ outbound: [], message: undefined, error: undefined });
    }
  },
}));

import * as vscode from "vscode";
import type { ChatClientState } from "../src/net/chatClient.js";
import type { ChatClient } from "../src/net/chatClient.js";
import { ChatViewProvider } from "../src/ui/chatViewProvider.js";

type Disposable = { dispose: () => void };

class ChatClientStub {
  private stateListeners: Array<(state: ChatClientState) => void> = [];
  private eventListeners: Array<(event: ServerEvent) => void> = [];
  sendMessageCalls: Array<{ text: string; clientMessageId?: string }> = [];
  sendModerationDenyCalls: string[] = [];
  sendModerationAllowCalls: string[] = [];
  disconnectCalls = 0;
  connectIfSignedInCalls = 0;
  signInAndConnectCalls = 0;
  signOutCalls = 0;

  constructor(private state: ChatClientState) {}

  getState(): ChatClientState {
    return this.state;
  }

  setState(next: ChatClientState): void {
    this.state = next;
    for (const listener of this.stateListeners) listener(next);
  }

  emitEvent(event: ServerEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  onState(listener: (state: ChatClientState) => void): Disposable {
    this.stateListeners.push(listener);
    listener(this.state);
    return { dispose: () => {} };
  }

  onEvent(listener: (event: ServerEvent) => void): Disposable {
    this.eventListeners.push(listener);
    return { dispose: () => {} };
  }

  refreshAuthState(): Promise<void> {
    return Promise.resolve();
  }

  connectIfSignedIn(): Promise<boolean> {
    this.connectIfSignedInCalls += 1;
    return Promise.resolve(true);
  }

  signInAndConnect(): Promise<void> {
    this.signInAndConnectCalls += 1;
    return Promise.resolve();
  }

  signOut(): Promise<void> {
    this.signOutCalls += 1;
    return Promise.resolve();
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  sendMessage(options: { text: string; clientMessageId?: string }): void {
    this.sendMessageCalls.push(options);
  }

  sendModerationDeny(): void {
    this.sendModerationDenyCalls.push("x");
  }

  sendModerationAllow(): void {
    this.sendModerationAllowCalls.push("x");
  }
}

class FakeWebview {
  options: unknown;
  html = "";
  readonly cspSource = "vscode-webview";
  posted: ExtOutbound[] = [];
  private receiveMessageCb: ((msg: unknown) => Promise<void> | void) | undefined;

  asWebviewUri(uri: UriLike): UriLike {
    return uri;
  }

  postMessage(message: ExtOutbound): Promise<boolean> {
    this.posted.push(message);
    return Promise.resolve(true);
  }

  onDidReceiveMessage(cb: (msg: unknown) => Promise<void> | void): Disposable {
    this.receiveMessageCb = cb;
    return { dispose: () => {} };
  }

  async receiveMessage(msg: UiInbound): Promise<void> {
    await this.receiveMessageCb?.(msg);
  }
}

class FakeWebviewView {
  visible = true;
  private visibilityCb: (() => void) | undefined;
  private disposeCb: (() => void) | undefined;

  constructor(public readonly webview: FakeWebview) {}

  onDidChangeVisibility(cb: () => void): Disposable {
    this.visibilityCb = cb;
    return { dispose: () => {} };
  }

  onDidDispose(cb: () => void): Disposable {
    this.disposeCb = cb;
    return { dispose: () => {} };
  }

  setVisible(next: boolean): void {
    this.visible = next;
    this.visibilityCb?.();
  }

  dispose(): void {
    this.disposeCb?.();
  }
}

function createOutput(): import("vscode").LogOutputChannel {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as import("vscode").LogOutputChannel;
}

function createContext(): import("vscode").ExtensionContext {
  return {
    extensionUri: vscode.Uri.parse("file:///extension") as unknown as import("vscode").Uri,
    extensionMode: vscode.ExtensionMode.Development as unknown as import("vscode").ExtensionMode,
  } as unknown as import("vscode").ExtensionContext;
}

function makeMessage(options: { id: string; text: string; createdAt: string }): ChatMessagePlain {
  return {
    id: options.id,
    user: {
      githubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
      login: "alice",
      avatarUrl: "https://example.test/alice.png",
      roles: [],
    },
    text: options.text,
    createdAt: options.createdAt,
  };
}

describe("ChatViewProvider", () => {
  function resetDmHarness(): void {
    dmHarness.openCalls = 0;
    dmHarness.threadSelectCalls = 0;
    dmHarness.sendCalls = 0;
    dmHarness.trustCalls = 0;
    dmHarness.resetAccountStateCalls = 0;
    dmHarness.ensureIdentityError = undefined;
    dmHarness.openError = undefined;
    dmHarness.threadSelectError = undefined;
    dmHarness.sendError = undefined;
    dmHarness.trustMessage = undefined;
    dmHarness.serverWelcomeCalls = 0;
    dmHarness.serverWelcomeDelay = undefined;
    dmHarness.serverWelcomeAdditional = undefined;
    dmHarness.serverWelcomeError = undefined;
    moderationHarness.includeSend = true;
    moderationHarness.snapshotMessage = moderationHarness.snapshot as unknown as ExtOutbound;
  }

  it("buffers outbound messages until ui/ready and then flushes", async () => {
    resetDmHarness();
    configHarness.autoConnect = false;
    const bus: ExtensionBus = createExtensionBus();
    const output = createOutput();

    const initialState: ChatClientState = { authStatus: "signedOut", status: "disconnected" };
    const client = new ChatClientStub(initialState);

    const provider = new ChatViewProvider(
      createContext(),
      client as unknown as ChatClient,
      output,
      bus,
    );

    const webview = new FakeWebview();
    const view = new FakeWebviewView(webview);
    provider.resolveWebviewView(view as unknown as import("vscode").WebviewView);

    const createdAt = new Date().toISOString();
    const first = makeMessage({ id: "m1", text: "hi", createdAt });
    const history: ChatMessagePlain[] = [first];
    client.emitEvent({
      version: PROTOCOL_VERSION,
      type: "server/welcome",
      user: first.user,
      serverTime: createdAt,
      history,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(webview.posted.length).toBe(0);

    await webview.receiveMessage({ type: "ui/ready" });

    expect(webview.posted.some((m) => m.type === "ext/history")).toBe(true);
    expect(webview.posted.some((m) => m.type === "ext/state")).toBe(true);
    expect(webview.posted.some((m) => m.type === "ext/dm.state")).toBe(true);

    client.setState({
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user: first.user,
    });

    await webview.receiveMessage({
      type: "ui/send",
      text: "hello",
      clientMessageId: "11111111-1111-1111-1111-111111111111",
    });

    expect(client.sendMessageCalls).toEqual([
      { text: "hello", clientMessageId: "11111111-1111-1111-1111-111111111111" },
    ]);

    view.setVisible(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.dispose();
  });

  it("handles UI actions and server errors", async () => {
    resetDmHarness();
    configHarness.autoConnect = false;

    const bus: ExtensionBus = createExtensionBus();
    const output = createOutput();

    const user = makeMessage({ id: "m1", text: "hi", createdAt: new Date().toISOString() }).user;
    const client = new ChatClientStub({
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user,
    });

    const provider = new ChatViewProvider(
      createContext(),
      client as unknown as ChatClient,
      output,
      bus,
    );
    const webview = new FakeWebview();
    const view = new FakeWebviewView(webview);
    provider.resolveWebviewView(view as unknown as import("vscode").WebviewView);

    await webview.receiveMessage({ type: "ui/ready" });

    externalHarness.openExternalHref.mockResolvedValueOnce({
      ok: false as const,
      message: "bad link",
    });
    await webview.receiveMessage({ type: "ui/link.open", href: "javascript:alert(1)" });
    expect(
      webview.posted.some(
        (m) => m.type === "ext/error" && "message" in m && m.message === "bad link",
      ),
    ).toBe(true);

    await webview.receiveMessage({ type: "ui/profile.open", login: "alice" });
    expect(webview.posted.some((m) => m.type === "ext/profile.result")).toBe(true);

    await webview.receiveMessage({ type: "ui/profile.openOnGitHub", login: "alice" });
    expect(externalHarness.openGitHubProfileInBrowser).toHaveBeenCalledWith("alice");

    await webview.receiveMessage({ type: "ui/moderation.user.deny", targetGithubUserId: "2" });
    await webview.receiveMessage({ type: "ui/moderation.user.allow", targetGithubUserId: "2" });
    expect(client.sendModerationDenyCalls.length).toBe(1);
    expect(client.sendModerationAllowCalls.length).toBe(1);

    dmHarness.trustMessage = { type: "ext/dm.state", threads: [] };
    await webview.receiveMessage({ type: "ui/dm.peerKey.trust", dmId: "dm:v1:1:2" });
    expect(dmHarness.trustCalls).toBe(1);
    expect(webview.posted.some((m) => m.type === "ext/dm.state")).toBe(true);

    const beforeNoopTrust = webview.posted.length;
    dmHarness.trustMessage = undefined;
    await webview.receiveMessage({ type: "ui/dm.peerKey.trust", dmId: "dm:v1:1:2" });
    expect(dmHarness.trustCalls).toBe(2);
    expect(webview.posted.length).toBe(beforeNoopTrust);

    client.emitEvent({
      version: PROTOCOL_VERSION,
      type: "server/error",
      code: "rate_limited",
      message: "Too many messages",
      clientMessageId: "11111111-1111-1111-1111-111111111111",
      retryAfterMs: 1234,
    });

    client.emitEvent({
      version: PROTOCOL_VERSION,
      type: "server/error",
      code: "forbidden",
      message: "Forbidden",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(webview.posted.some((m) => m.type === "ext/message.send.error")).toBe(true);
    expect(webview.posted.some((m) => m.type === "ext/error")).toBe(true);

    await webview.receiveMessage({ type: "ui/signIn" });
    await webview.receiveMessage({ type: "ui/signOut" });
    await webview.receiveMessage({ type: "ui/reconnect" });
    expect(client.signInAndConnectCalls).toBe(1);
    expect(client.signOutCalls).toBe(1);
    expect(client.connectIfSignedInCalls).toBe(1);

    const clientMessageId = "11111111-1111-1111-1111-111111111111";
    await webview.receiveMessage({ type: "ui/send", text: "hello", clientMessageId });
    expect(client.sendMessageCalls.some((c) => c.clientMessageId === clientMessageId)).toBe(true);

    view.dispose();
  });

  it("reconnects on config change only when UI is ready and auto-connect is enabled", async () => {
    resetDmHarness();
    const bus: ExtensionBus = createExtensionBus();
    const output = createOutput();
    const user = makeMessage({ id: "m1", text: "hi", createdAt: new Date().toISOString() }).user;
    const client = new ChatClientStub({
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user,
    });

    const provider = new ChatViewProvider(
      createContext(),
      client as unknown as ChatClient,
      output,
      bus,
    );
    const webview = new FakeWebview();
    const view = new FakeWebviewView(webview);
    provider.resolveWebviewView(view as unknown as import("vscode").WebviewView);

    configHarness.autoConnect = true;
    provider.onConfigChanged();
    expect(client.disconnectCalls).toBe(1);
    expect(client.connectIfSignedInCalls).toBe(0);

    await webview.receiveMessage({ type: "ui/ready" });
    provider.onConfigChanged();
    expect(client.disconnectCalls).toBe(2);
    expect(client.connectIfSignedInCalls).toBeGreaterThanOrEqual(1);

    configHarness.autoConnect = false;
    provider.onConfigChanged();
    expect(client.disconnectCalls).toBe(3);
  });

  it("resets direct-message account state from auth bus events", async () => {
    resetDmHarness();
    configHarness.autoConnect = false;
    const bus: ExtensionBus = createExtensionBus();
    const output = createOutput();
    const user = makeMessage({ id: "m1", text: "hi", createdAt: new Date().toISOString() }).user;
    const client = new ChatClientStub({
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user,
    });

    const provider = new ChatViewProvider(
      createContext(),
      client as unknown as ChatClient,
      output,
      bus,
    );
    const webview = new FakeWebview();
    const view = new FakeWebviewView(webview);
    provider.resolveWebviewView(view as unknown as import("vscode").WebviewView);
    await webview.receiveMessage({ type: "ui/ready" });
    webview.posted.length = 0;

    bus.emit("auth/signedOut", { by: "user" });
    bus.emit("auth/githubAccount.changed", {
      prevGithubAccountId: "a",
      nextGithubAccountId: "b",
    });

    expect(dmHarness.resetAccountStateCalls).toBe(2);
    const stateMessages = webview.posted.filter((m) => m.type === "ext/dm.state");
    expect(stateMessages.length).toBe(2);
  });

  it("serializes server event routing across async handlers", async () => {
    resetDmHarness();
    configHarness.autoConnect = false;

    const bus: ExtensionBus = createExtensionBus();
    const output = createOutput();

    const user = makeMessage({ id: "m1", text: "hi", createdAt: new Date().toISOString() }).user;
    const client = new ChatClientStub({
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user,
    });

    const provider = new ChatViewProvider(
      createContext(),
      client as unknown as ChatClient,
      output,
      bus,
    );
    const webview = new FakeWebview();
    const view = new FakeWebviewView(webview);
    provider.resolveWebviewView(view as unknown as import("vscode").WebviewView);
    await webview.receiveMessage({ type: "ui/ready" });
    webview.posted.length = 0;

    let releaseWelcome: (() => void) | undefined;
    dmHarness.serverWelcomeDelay = new Promise<void>((resolve) => {
      releaseWelcome = resolve;
    });

    client.emitEvent({
      version: PROTOCOL_VERSION,
      type: "server/dm.welcome",
      dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
      peerGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
      history: [],
    });
    client.emitEvent({
      version: PROTOCOL_VERSION,
      type: "server/error",
      code: "forbidden",
      message: "Forbidden",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(webview.posted.some((m) => m.type === "ext/error")).toBe(false);

    releaseWelcome?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dmStateIdx = webview.posted.findIndex((m) => m.type === "ext/dm.state");
    const errorIdx = webview.posted.findIndex(
      (m) => m.type === "ext/error" && "message" in m && m.message === "Forbidden",
    );
    expect(dmStateIdx).toBeGreaterThanOrEqual(0);
    expect(errorIdx).toBeGreaterThan(dmStateIdx);

    view.dispose();
  });

  it("no-ops config changes before the webview is resolved", () => {
    resetDmHarness();
    configHarness.autoConnect = true;

    const bus: ExtensionBus = createExtensionBus();
    const output = createOutput();
    const client = new ChatClientStub({ authStatus: "signedOut", status: "disconnected" });
    const provider = new ChatViewProvider(
      createContext(),
      client as unknown as ChatClient,
      output,
      bus,
    );

    provider.onConfigChanged();
    expect(client.disconnectCalls).toBe(0);
  });

  it("handles bus resets and UI action error paths across ready/non-ready boundaries", async () => {
    resetDmHarness();
    configHarness.autoConnect = false;
    moderationHarness.includeSend = false;
    dmHarness.openError = "dm open failed";
    dmHarness.threadSelectError = "dm thread failed";
    dmHarness.sendError = "dm send failed";

    const bus: ExtensionBus = createExtensionBus();
    const output = createOutput();
    const user = makeMessage({ id: "m1", text: "hi", createdAt: new Date().toISOString() }).user;
    const client = new ChatClientStub({
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user,
    });

    const provider = new ChatViewProvider(
      createContext(),
      client as unknown as ChatClient,
      output,
      bus,
    );
    const webview = new FakeWebview();
    const view = new FakeWebviewView(webview);
    provider.resolveWebviewView(view as unknown as import("vscode").WebviewView);

    const beforeBusMessages = webview.posted.length;
    bus.emit("auth/signedOut", { by: "user" });
    bus.emit("auth/githubAccount.changed", {
      prevGithubAccountId: "a",
      nextGithubAccountId: "b",
    });
    expect(dmHarness.resetAccountStateCalls).toBe(2);
    expect(webview.posted.length).toBe(beforeBusMessages);

    await webview.receiveMessage({ type: "ui/ready" });

    externalHarness.openExternalHref.mockResolvedValueOnce({ ok: true as const });
    await webview.receiveMessage({ type: "ui/link.open", href: "https://example.test" });

    await webview.receiveMessage({ type: "ui/moderation.user.deny", targetGithubUserId: "2" });
    await webview.receiveMessage({ type: "ui/moderation.user.allow", targetGithubUserId: "2" });
    expect(client.sendModerationDenyCalls.length).toBe(0);
    expect(client.sendModerationAllowCalls.length).toBe(0);

    await webview.receiveMessage({
      type: "ui/dm.open",
      peer: {
        githubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
        login: "bob",
        avatarUrl: "https://example.test/bob.png",
        roles: [],
      },
    });
    await webview.receiveMessage({
      type: "ui/dm.thread.select",
      dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
    });
    await webview.receiveMessage({
      type: "ui/dm.send",
      dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
      text: "hello",
    });

    const errorTexts = webview.posted
      .filter((m): m is Extract<ExtOutbound, { type: "ext/error" }> => m.type === "ext/error")
      .map((m) => m.message);
    expect(errorTexts).toContain("dm open failed");
    expect(errorTexts).toContain("dm thread failed");
    expect(errorTexts).toContain("dm send failed");

    client.setState({
      authStatus: "signedIn",
      status: "disconnected",
      backendUrl: "http://example.test",
      user,
    });
    const sendsBefore = client.sendMessageCalls.length;
    await webview.receiveMessage({
      type: "ui/send",
      text: "ignored while disconnected",
      clientMessageId: "33333333-3333-3333-3333-333333333333",
    });
    expect(client.sendMessageCalls.length).toBe(sendsBefore);

    view.dispose();
  });

  it("posts direct-message additional/error payloads and logs identity-publish failures", async () => {
    resetDmHarness();
    configHarness.autoConnect = false;
    dmHarness.ensureIdentityError = "publish_failed";
    dmHarness.serverWelcomeAdditional = {
      type: "ext/dm.history",
      dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
      history: [],
    };
    dmHarness.serverWelcomeError = "dm welcome failed";
    moderationHarness.snapshotMessage = undefined;

    const bus: ExtensionBus = createExtensionBus();
    const output = createOutput();
    const user = makeMessage({ id: "m1", text: "hi", createdAt: new Date().toISOString() }).user;
    const client = new ChatClientStub({
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user,
    });

    const provider = new ChatViewProvider(
      createContext(),
      client as unknown as ChatClient,
      output,
      bus,
    );
    const webview = new FakeWebview();
    const view = new FakeWebviewView(webview);
    provider.resolveWebviewView(view as unknown as import("vscode").WebviewView);
    await webview.receiveMessage({ type: "ui/ready" });
    webview.posted.length = 0;

    client.setState({
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    client.emitEvent({
      version: PROTOCOL_VERSION,
      type: "server/dm.welcome",
      dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
      peerGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
      history: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(webview.posted.some((m) => m.type === "ext/dm.state")).toBe(true);
    expect(webview.posted.some((m) => m.type === "ext/dm.history")).toBe(true);
    expect(
      webview.posted.some(
        (m) => m.type === "ext/error" && "message" in m && m.message === "dm welcome failed",
      ),
    ).toBe(true);
    expect(
      (output.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.some((args) =>
        String(args[0]).includes("dm identity publish failed"),
      ),
    ).toBe(true);

    view.dispose();
  });
});
