import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "@vscode-chat/protocol";
import type { ServerEvent } from "@vscode-chat/protocol";
import { ClientEventBus } from "../src/net/chatClient/clientEventBus.js";
import type { ChatClientState } from "../src/net/chatClient.js";

function signedOutState(): ChatClientState {
  return { authStatus: "signedOut", status: "disconnected" };
}

describe("ClientEventBus", () => {
  it("emits initial state and subsequent state updates", () => {
    const bus = new ClientEventBus({ initialState: signedOutState() });
    const listener = vi.fn();

    const disposable = bus.onState(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(signedOutState());

    const connected: ChatClientState = {
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user: {
        githubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
        login: "alice",
        avatarUrl: "https://example.test/a.png",
        roles: [],
      },
    };
    bus.emitState(connected);
    expect(listener).toHaveBeenLastCalledWith(connected);

    disposable.dispose();
    bus.emitState(signedOutState());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("forwards server events to subscribers", () => {
    const bus = new ClientEventBus({ initialState: signedOutState() });
    const listener = vi.fn();
    bus.onEvent(listener);

    const event: ServerEvent = {
      version: PROTOCOL_VERSION,
      type: "server/error",
      code: "server_error",
      message: "boom",
    };
    bus.emitEvent(event);

    expect(listener).toHaveBeenCalledWith(event);
  });
});
