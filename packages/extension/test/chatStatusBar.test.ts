import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "@vscode-chat/protocol";
import type { AuthUser, GithubUserId, PresenceSnapshot, ServerEvent } from "@vscode-chat/protocol";
import { createMockAuthUser } from "./helpers/mockAuthUser.js";

type Disposable = { dispose: () => void };

const statusBarHarness = vi.hoisted(() => ({
  item: {
    name: "",
    command: "",
    text: "",
    tooltip: undefined as unknown,
    shown: 0,
    hidden: 0,
    show: () => {
      statusBarHarness.item.shown += 1;
    },
    hide: () => {
      statusBarHarness.item.hidden += 1;
    },
    dispose: () => {},
  },
}));

vi.mock("vscode", () => ({
  StatusBarAlignment: { Right: 2 },
  window: {
    createStatusBarItem: () => statusBarHarness.item,
  },
  MarkdownString: class MarkdownString {
    isTrusted = false;
    constructor(public readonly value: string) {}
  },
}));

import type { ChatClientState } from "../src/net/chatClient.js";
import type { ChatClient } from "../src/net/chatClient.js";
import { ChatStatusBar } from "../src/ui/chatStatusBar.js";

class ChatClientStub {
  private stateListeners: Array<(state: ChatClientState) => void> = [];
  private eventListeners: Array<(event: ServerEvent) => void> = [];

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
    return { dispose: () => {} };
  }

  onEvent(listener: (event: ServerEvent) => void): Disposable {
    this.eventListeners.push(listener);
    return { dispose: () => {} };
  }
}

function makeUser(options: { githubUserId: string }): AuthUser {
  return createMockAuthUser({
    githubUserId: options.githubUserId,
    login: "alice",
  }) as AuthUser;
}

describe("ChatStatusBar", () => {
  it("shows/hides based on connection status and updates on presence", () => {
    statusBarHarness.item.text = "";
    statusBarHarness.item.tooltip = undefined;
    statusBarHarness.item.shown = 0;
    statusBarHarness.item.hidden = 0;

    const client = new ChatClientStub({ authStatus: "signedOut", status: "disconnected" });
    const bar = new ChatStatusBar(client as unknown as ChatClient);

    expect(statusBarHarness.item.hidden).toBeGreaterThanOrEqual(1);
    expect(statusBarHarness.item.shown).toBe(0);

    client.setState({
      authStatus: "signedIn",
      status: "connecting",
      backendUrl: "http://example.test",
      user: makeUser({ githubUserId: "1" }),
    });

    expect(statusBarHarness.item.shown).toBeGreaterThanOrEqual(1);
    expect(statusBarHarness.item.text).toContain("Connecting");

    const snapshot: PresenceSnapshot = [{ user: makeUser({ githubUserId: "1" }), connections: 1 }];
    client.emitEvent({ version: PROTOCOL_VERSION, type: "server/presence", snapshot });

    client.setState({
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user: makeUser({ githubUserId: "1" }),
    });

    expect(statusBarHarness.item.text).toContain("Online");
    bar.dispose();
  });
});
