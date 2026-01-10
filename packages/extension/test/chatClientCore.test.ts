import { describe, expect, it } from "vitest";
import { AuthUserSchema } from "@vscode-chat/protocol";
import {
  computeReconnectDelayMs,
  initialChatClientCoreState,
  reduceChatClientCore,
  type ChatClientCoreState,
} from "../src/core/chatClientCore.js";

const user = AuthUserSchema.parse({
  githubUserId: "123",
  login: "octocat",
  avatarUrl: "https://example.com/a.png",
  roles: [],
});

const handshake429ConnectTelemetry = {
  type: "cmd/telemetry.send",
  event: {
    name: "vscodeChat.ws.connect",
    outcome: "handshake_http_error",
    httpStatus: 429,
    usedCachedSession: false,
    recovered: false,
  },
} as const;

function makeReconnectHandshakePendingState(options: {
  reconnectAttempt: number;
}): ChatClientCoreState {
  return {
    ...initialChatClientCoreState(),
    publicState: {
      authStatus: "signedIn",
      status: "connecting",
      backendUrl: "http://127.0.0.1:8787",
      user,
    },
    reconnectAttempt: options.reconnectAttempt,
    reconnectScheduled: false,
    pending: {
      type: "pending/connect.ws",
      origin: "reconnect",
      backendUrl: "http://127.0.0.1:8787",
      githubAccountId: "acct",
      accessToken: "gh-token",
      token: "backend-token",
      user,
      usedCachedSession: false,
      recovered: false,
    },
  };
}

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

  it.each([
    {
      name: "clamps reconnect delay to Retry-After when handshake is 429",
      reconnectAttempt: 0,
      error: { type: "handshake_http_error", status: 429, retryAfterMs: 10_000 },
      expectedReconnectAttempt: 1,
      expectedCommands: [
        handshake429ConnectTelemetry,
        {
          type: "cmd/telemetry.send",
          event: { name: "vscodeChat.ws.reconnect_scheduled", attempt: 0, delayMs: 10_000 },
        },
        { type: "cmd/reconnect.schedule", delayMs: 10_000 },
      ],
    },
    {
      name: "stops auto-reconnect on capacity 429 (structured code)",
      reconnectAttempt: 3,
      error: {
        type: "handshake_http_error",
        status: 429,
        handshakeRejection: { code: "too_many_connections", message: "Too many connections" },
      },
      expectedReconnectAttempt: 3,
      expectedCommands: [handshake429ConnectTelemetry, { type: "cmd/reconnect.cancel" }],
    },
    {
      name: "falls back to substring classification for legacy 429 bodies",
      reconnectAttempt: 3,
      error: { type: "handshake_http_error", status: 429, bodyText: "Too many connections" },
      expectedReconnectAttempt: 3,
      expectedCommands: [handshake429ConnectTelemetry, { type: "cmd/reconnect.cancel" }],
    },
  ])(
    "$name (reconnect origin)",
    ({ reconnectAttempt, error, expectedReconnectAttempt, expectedCommands }) => {
      const s0 = makeReconnectHandshakePendingState({ reconnectAttempt });

      const { state: s1, commands } = reduceChatClientCore(s0, {
        type: "ws/open.result",
        ok: false,
        error,
      });

      expect(s1.publicState.status).toBe("disconnected");
      expect(s1.pending).toBeUndefined();
      expect(s1.reconnectAttempt).toBe(expectedReconnectAttempt);
      expect(s1.reconnectScheduled).toBe(true);
      expect(commands).toEqual(expectedCommands);
    },
  );

  it("updates connected identity from server welcome (authoritative roles)", () => {
    const s0: ChatClientCoreState = {
      ...initialChatClientCoreState(),
      publicState: {
        authStatus: "signedIn",
        status: "connected",
        backendUrl: "http://127.0.0.1:8787",
        user,
      },
      cachedSession: { githubAccountId: "acct", token: "t", expiresAtMs: 120_000, user },
      githubAccountId: "acct",
    };

    const welcomeUser = AuthUserSchema.parse({ ...user, roles: ["moderator"] });
    const { state: s1 } = reduceChatClientCore(s0, { type: "ws/welcome", user: welcomeUser });

    expect(s1.publicState.status).toBe("connected");
    expect(s1.publicState.authStatus).toBe("signedIn");
    expect(s1.publicState.user.roles).toEqual(["moderator"]);
    expect(s1.cachedSession?.user.roles).toEqual(["moderator"]);
  });

  it("signs out explicitly and suppresses auto-connect until next interactive sign-in", () => {
    const s0: ChatClientCoreState = {
      ...initialChatClientCoreState(),
      publicState: {
        authStatus: "signedIn",
        status: "connected",
        backendUrl: "http://127.0.0.1:8787",
        user,
      },
      githubAccountId: "acct",
      cachedSession: { githubAccountId: "acct", token: "t", expiresAtMs: 120_000, user },
      reconnectAttempt: 2,
      reconnectScheduled: true,
    };

    const { state: s1, commands: c1 } = reduceChatClientCore(s0, { type: "ui/signOut" });

    expect(s1.publicState.authStatus).toBe("signedOut");
    expect(s1.publicState.status).toBe("disconnected");
    expect(s1.githubAccountId).toBeUndefined();
    expect(s1.cachedSession).toBeUndefined();
    expect(s1.authSuppressedByUser).toBe(true);
    expect(s1.clearSessionPreferenceOnNextSignIn).toBe(true);
    expect(c1).toEqual([
      { type: "cmd/reconnect.cancel" },
      { type: "cmd/ws.close", code: 1000, reason: "user_signout" },
    ]);

    const { state: s2, commands: c2 } = reduceChatClientCore(s1, {
      type: "auth/refresh.requested",
    });
    expect(s2.publicState.authStatus).toBe("signedOut");
    expect(c2).toEqual([
      { type: "cmd/reconnect.cancel" },
      { type: "cmd/ws.close", code: 1000, reason: "auth_suppressed" },
    ]);

    const { state: s3, commands: c3 } = reduceChatClientCore(s2, {
      type: "ui/connect",
      origin: "user",
      backendUrl: "http://127.0.0.1:8787",
      interactive: false,
    });
    expect(s3.publicState.authStatus).toBe("signedOut");
    expect(c3).toEqual([]);

    const { commands: c4 } = reduceChatClientCore(s3, {
      type: "ui/connect",
      origin: "user",
      backendUrl: "http://127.0.0.1:8787",
      interactive: true,
    });
    expect(c4).toEqual([
      { type: "cmd/reconnect.cancel" },
      { type: "cmd/github.session.get", interactive: true, clearSessionPreference: true },
    ]);
  });
});
