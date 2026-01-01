import { describe, expect, it } from "vitest";
import {
  computeReconnectDelayMs,
  initialChatClientCoreState,
  reduceChatClientCore,
  type ChatClientCoreState,
} from "../src/core/chatClientCore.js";

const user = { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" };

describe("chatClientCore", () => {
  it("reuses cached session when valid", () => {
    const s0: ChatClientCoreState = {
      ...initialChatClientCoreState(),
      publicState: { authStatus: "signedIn", status: "disconnected" },
      githubAccountId: "acct",
      cachedSession: { githubAccountId: "acct", token: "cached-token", expiresAtMs: 120_000, user },
    };

    const { state: s1 } = reduceChatClientCore(s0, {
      type: "ui/connect",
      origin: "user",
      backendUrl: "http://127.0.0.1:8787",
      interactive: false,
    });

    const { state: s2, commands } = reduceChatClientCore(s1, {
      type: "github/session.result",
      ok: true,
      session: { githubAccountId: "acct", accessToken: "gh-token" },
      nowMs: 0,
    });

    expect(s2.publicState.status).toBe("connecting");
    expect(s2.publicState.authStatus).toBe("signedIn");
    expect(s2.publicState.user?.login).toBe("octocat");
    expect(commands).toEqual([
      { type: "cmd/ws.open", backendUrl: "http://127.0.0.1:8787", token: "cached-token" },
    ]);
  });

  it("exchanges token when cached session is expired (or within skew)", () => {
    const s0: ChatClientCoreState = {
      ...initialChatClientCoreState(),
      publicState: { authStatus: "signedIn", status: "disconnected" },
      githubAccountId: "acct",
      cachedSession: { githubAccountId: "acct", token: "cached-token", expiresAtMs: 30_000, user },
    };

    const { state: s1 } = reduceChatClientCore(s0, {
      type: "ui/connect",
      origin: "user",
      backendUrl: "http://127.0.0.1:8787",
      interactive: false,
    });

    const { commands } = reduceChatClientCore(s1, {
      type: "github/session.result",
      ok: true,
      session: { githubAccountId: "acct", accessToken: "gh-token" },
      nowMs: 0,
    });

    expect(commands).toEqual([
      { type: "cmd/auth.exchange", backendUrl: "http://127.0.0.1:8787", accessToken: "gh-token" },
    ]);
  });

  it("recovers from 401 handshake when using cached session", () => {
    const s0: ChatClientCoreState = {
      ...initialChatClientCoreState(),
      publicState: {
        authStatus: "signedIn",
        status: "connecting",
        backendUrl: "http://127.0.0.1:8787",
        user,
      },
      githubAccountId: "acct",
      cachedSession: { githubAccountId: "acct", token: "cached-token", expiresAtMs: 120_000, user },
      pending: {
        type: "pending/connect.ws",
        origin: "user",
        backendUrl: "http://127.0.0.1:8787",
        githubAccountId: "acct",
        accessToken: "gh-token",
        token: "cached-token",
        user,
        usedCachedSession: true,
        recovered: false,
      },
    };

    const { state: s1, commands } = reduceChatClientCore(s0, {
      type: "ws/open.result",
      ok: false,
      error: { type: "handshake_http_error", status: 401 },
    });

    expect(s1.pending?.type).toBe("pending/connect.exchange");
    expect(commands).toEqual([
      { type: "cmd/auth.exchange", backendUrl: "http://127.0.0.1:8787", accessToken: "gh-token" },
    ]);
  });

  it("schedules reconnect with exponential backoff", () => {
    expect(computeReconnectDelayMs(0)).toBe(500);
    expect(computeReconnectDelayMs(1)).toBe(1000);
    expect(computeReconnectDelayMs(6)).toBe(30_000);
    expect(computeReconnectDelayMs(10)).toBe(30_000);

    const s0: ChatClientCoreState = {
      ...initialChatClientCoreState(),
      publicState: {
        authStatus: "signedIn",
        status: "connected",
        backendUrl: "http://127.0.0.1:8787",
        user,
      },
      reconnectAttempt: 0,
      reconnectScheduled: false,
    };

    const { state: s1, commands } = reduceChatClientCore(s0, {
      type: "ws/closed",
      autoReconnectEnabled: true,
    });

    expect(s1.publicState.status).toBe("disconnected");
    expect(s1.reconnectAttempt).toBe(1);
    expect(s1.reconnectScheduled).toBe(true);
    expect(commands).toEqual([
      {
        type: "cmd/telemetry.send",
        event: { name: "vscodeChat.ws.reconnect_scheduled", attempt: 0, delayMs: 500 },
      },
      { type: "cmd/reconnect.schedule", delayMs: 500 },
    ]);
  });
});
