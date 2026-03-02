import { describe, expect, it } from "vitest";
import type { AuthUser } from "@vscode-chat/protocol";
import { initialChatClientCoreState } from "../src/core/chatClientCore/helpers.js";
import { handleAuthExchangeResult } from "../src/core/chatClientCore/reducer/authExchangeResult.js";
import { handleGithubSessionResult } from "../src/core/chatClientCore/reducer/githubSessionResult.js";
import { handleWsOpenResult } from "../src/core/chatClientCore/reducer/wsOpenResult.js";
import type { ChatClientCoreState } from "../src/core/chatClientCore/types.js";

function makeUser(options: { githubUserId: string; login: string }): AuthUser {
  return {
    githubUserId: options.githubUserId as import("@vscode-chat/protocol").GithubUserId,
    login: options.login,
    avatarUrl: `https://example.test/${options.login}.png`,
    roles: [],
  };
}

describe("chatClientCore reducers", () => {
  it("handles github session result transitions", () => {
    const user = makeUser({ githubUserId: "1", login: "alice" });
    const base = initialChatClientCoreState({
      authSuppressedByUser: true,
      clearSessionPreferenceOnNextSignIn: true,
    });

    const noPending = handleGithubSessionResult(base, {
      type: "github/session.result",
      ok: true,
      session: { githubAccountId: "acct", accessToken: "gh" },
      nowMs: 1,
    });
    expect(noPending.commands).toEqual([]);
    expect(noPending.state).toBe(base);

    const pendingAuth: ChatClientCoreState = {
      ...base,
      publicState: {
        authStatus: "signedIn",
        status: "connected",
        backendUrl: "http://example.test",
        user,
      },
      githubAccountId: "acct",
      cachedSession: {
        githubAccountId: "acct",
        token: "t",
        expiresAtMs: Date.now() + 60_000,
        user,
      },
      pending: { type: "pending/auth", interactive: true },
      reconnectAttempt: 3,
      reconnectScheduled: true,
    };

    const authMissing = handleGithubSessionResult(pendingAuth, {
      type: "github/session.result",
      ok: false,
      nowMs: 1,
      error: new Error("no session"),
    });
    expect(authMissing.state.publicState.authStatus).toBe("signedOut");
    expect(authMissing.state.cachedSession).toBeUndefined();
    expect(authMissing.commands.some((c) => c.type === "cmd/reconnect.cancel")).toBe(true);
    expect(authMissing.commands.some((c) => c.type === "cmd/ws.close")).toBe(true);
    expect(authMissing.commands.some((c) => c.type === "cmd/raise")).toBe(true);

    const accountChanged = handleGithubSessionResult(
      { ...pendingAuth, pending: { type: "pending/auth", interactive: false } },
      {
        type: "github/session.result",
        ok: true,
        session: { githubAccountId: "acct2", accessToken: "gh2" },
        nowMs: 1,
      },
    );
    expect(accountChanged.state.githubAccountId).toBe("acct2");
    expect(accountChanged.state.cachedSession).toBeUndefined();
    expect(accountChanged.state.publicState.status).toBe("disconnected");
    expect(accountChanged.commands.some((c) => c.type === "cmd/ws.close")).toBe(true);

    const cached = {
      githubAccountId: "acct",
      token: "token",
      expiresAtMs: 999_999_999,
      user,
    };
    const pendingConnect: ChatClientCoreState = {
      ...base,
      cachedSession: cached,
      pending: {
        type: "pending/connect.session",
        origin: "user",
        backendUrl: "http://example.test",
        interactive: false,
      },
    };

    const connectOk = handleGithubSessionResult(pendingConnect, {
      type: "github/session.result",
      ok: true,
      session: { githubAccountId: "acct", accessToken: "gh" },
      nowMs: 1,
    });
    expect(connectOk.state.pending?.type).toBe("pending/connect.ws");
    expect(connectOk.commands.some((c) => c.type === "cmd/ws.open")).toBe(true);
  });

  it("handles github session edge-cases (interactive flags, cache expiry, and non-interactive failures)", () => {
    const user = makeUser({ githubUserId: "1", login: "alice" });
    const base = initialChatClientCoreState({
      authSuppressedByUser: true,
      clearSessionPreferenceOnNextSignIn: true,
    });

    const interactivePendingAuth: ChatClientCoreState = {
      ...base,
      publicState: { authStatus: "signedIn", status: "disconnected" },
      githubAccountId: "acct",
      pending: { type: "pending/auth", interactive: true },
    };
    const authOk = handleGithubSessionResult(interactivePendingAuth, {
      type: "github/session.result",
      ok: true,
      session: { githubAccountId: "acct", accessToken: "gh" },
      nowMs: 1,
    });
    expect(authOk.commands).toEqual([]);
    expect(authOk.state.pending).toBeUndefined();
    expect(authOk.state.authSuppressedByUser).toBe(false);
    expect(authOk.state.clearSessionPreferenceOnNextSignIn).toBe(false);

    const staleCached = {
      githubAccountId: "acct",
      token: "token",
      expiresAtMs: 100_000,
      user,
    };
    const connectWithStaleCache: ChatClientCoreState = {
      ...base,
      cachedSession: staleCached,
      pending: {
        type: "pending/connect.session",
        origin: "user",
        backendUrl: "http://example.test",
        interactive: true,
      },
    };
    const connectStale = handleGithubSessionResult(connectWithStaleCache, {
      type: "github/session.result",
      ok: true,
      session: { githubAccountId: "acct", accessToken: "gh" },
      nowMs: 90_000,
    });
    expect(connectStale.state.pending?.type).toBe("pending/connect.exchange");
    expect(connectStale.commands.some((c) => c.type === "cmd/auth.exchange")).toBe(true);
    expect(connectStale.state.publicState.status).toBe("connecting");
    expect(connectStale.state.publicState.backendUrl).toBe("http://example.test");
    expect(connectStale.state.authSuppressedByUser).toBe(false);
    expect(connectStale.state.clearSessionPreferenceOnNextSignIn).toBe(false);

    const nonInteractiveFailure: ChatClientCoreState = {
      ...base,
      publicState: {
        authStatus: "signedIn",
        status: "disconnected",
        backendUrl: "http://prev.test",
      },
      pending: {
        type: "pending/connect.session",
        origin: "user",
        backendUrl: "http://new.test",
        interactive: false,
      },
    };
    const connectFail = handleGithubSessionResult(nonInteractiveFailure, {
      type: "github/session.result",
      ok: false,
      nowMs: 1,
    });
    expect(connectFail.commands.some((c) => c.type === "cmd/raise")).toBe(false);
    expect(connectFail.state.publicState.authStatus).toBe("signedOut");
    expect(connectFail.state.publicState.status).toBe("disconnected");
    expect(connectFail.state.publicState.backendUrl).toBe("http://prev.test");

    const pendingWs: ChatClientCoreState = {
      ...base,
      publicState: {
        authStatus: "signedIn",
        status: "connecting",
        backendUrl: "http://example.test",
        user,
      },
      pending: {
        type: "pending/connect.ws",
        origin: "user",
        backendUrl: "http://example.test",
        githubAccountId: "acct",
        accessToken: "gh",
        token: "t",
        user,
        usedCachedSession: false,
        recovered: false,
      },
    };
    const ignoredDuringWsOpen = handleGithubSessionResult(pendingWs, {
      type: "github/session.result",
      ok: false,
      nowMs: 1,
      error: new Error("irrelevant"),
    });
    expect(ignoredDuringWsOpen.commands).toEqual([]);
    expect(ignoredDuringWsOpen.state).toBe(pendingWs);
  });

  it("handles auth exchange results (success and failure)", () => {
    const user = makeUser({ githubUserId: "1", login: "alice" });
    const base = initialChatClientCoreState();

    const pendingExchange: ChatClientCoreState = {
      ...base,
      githubAccountId: "acct",
      pending: {
        type: "pending/connect.exchange",
        origin: "user",
        backendUrl: "http://example.test",
        githubAccountId: "acct",
        accessToken: "gh",
        usedCachedSession: false,
        recovered: false,
      },
    };

    const http401 = handleAuthExchangeResult(pendingExchange, {
      type: "auth/exchange.result",
      ok: false,
      error: { type: "http", status: 401 },
    });
    expect(http401.state.publicState.authStatus).toBe("signedOut");
    expect(http401.commands.some((c) => c.type === "cmd/raise")).toBe(true);
    expect(http401.commands.some((c) => c.type === "cmd/ws.close")).toBe(true);

    const invalidResponse = handleAuthExchangeResult(pendingExchange, {
      type: "auth/exchange.result",
      ok: false,
      error: { type: "invalid_response" },
    });
    expect(invalidResponse.state.publicState.status).toBe("disconnected");
    expect(invalidResponse.commands.some((c) => c.type === "cmd/raise")).toBe(true);

    const ok = handleAuthExchangeResult(pendingExchange, {
      type: "auth/exchange.result",
      ok: true,
      session: { token: "t", expiresAtMs: Date.now() + 60_000, user },
    });
    expect(ok.state.pending?.type).toBe("pending/connect.ws");
    expect(ok.commands.some((c) => c.type === "cmd/ws.open")).toBe(true);
    expect(ok.commands.some((c) => c.type === "cmd/telemetry.send")).toBe(true);
  });

  it("handles websocket open failures (recovery and 429 policies)", () => {
    const user = makeUser({ githubUserId: "1", login: "alice" });
    const base = initialChatClientCoreState();

    const pendingWs: ChatClientCoreState = {
      ...base,
      reconnectAttempt: 0,
      pending: {
        type: "pending/connect.ws",
        origin: "reconnect",
        backendUrl: "http://example.test",
        githubAccountId: "acct",
        accessToken: "gh",
        token: "t",
        user,
        usedCachedSession: true,
        recovered: false,
      },
    };

    const recover401 = handleWsOpenResult(pendingWs, {
      type: "ws/open.result",
      ok: false,
      error: { type: "handshake_http_error", status: 401 },
    });
    expect(recover401.state.pending?.type).toBe("pending/connect.exchange");
    expect(recover401.commands.some((c) => c.type === "cmd/auth.exchange")).toBe(true);

    const rateLimited429 = handleWsOpenResult(pendingWs, {
      type: "ws/open.result",
      ok: false,
      error: { type: "handshake_http_error", status: 429, retryAfterMs: 5000 },
    });
    expect(rateLimited429.state.reconnectScheduled).toBe(true);
    expect(rateLimited429.commands.some((c) => c.type === "cmd/reconnect.schedule")).toBe(true);

    const roomFull = handleWsOpenResult(pendingWs, {
      type: "ws/open.result",
      ok: false,
      error: {
        type: "handshake_http_error",
        status: 429,
        bodyText: "Room is full",
      },
    });
    expect(roomFull.commands.some((c) => c.type === "cmd/reconnect.cancel")).toBe(true);

    const userInitiated: ChatClientCoreState = {
      ...pendingWs,
      pending: { ...pendingWs.pending, origin: "user" },
    } as ChatClientCoreState;

    const tooMany = handleWsOpenResult(userInitiated, {
      type: "ws/open.result",
      ok: false,
      error: { type: "handshake_http_error", status: 429, bodyText: "Too many connections" },
    });
    expect(tooMany.commands.some((c) => c.type === "cmd/raise")).toBe(true);

    const unknown429Reconnect = handleWsOpenResult(pendingWs, {
      type: "ws/open.result",
      ok: false,
      error: { type: "handshake_http_error", status: 429 },
    });
    expect(unknown429Reconnect.commands.some((c) => c.type === "cmd/reconnect.cancel")).toBe(true);
    expect(
      unknown429Reconnect.commands.some(
        (c) => c.type === "cmd/telemetry.send" && c.event.name === "vscodeChat.ws.legacy_fallback",
      ),
    ).toBe(false);

    const userRateLimited = handleWsOpenResult(userInitiated, {
      type: "ws/open.result",
      ok: false,
      error: { type: "handshake_http_error", status: 429, retryAfterMs: 2500 },
    });
    expect(
      userRateLimited.commands.some(
        (c) =>
          c.type === "cmd/raise" &&
          c.error instanceof Error &&
          c.error.message.includes("Retry after 3s"),
      ),
    ).toBe(true);

    const reconnectNetworkError = handleWsOpenResult(pendingWs, {
      type: "ws/open.result",
      ok: false,
      error: { type: "network_error" },
    });
    expect(reconnectNetworkError.commands.some((c) => c.type === "cmd/raise")).toBe(false);

    const ok = handleWsOpenResult(userInitiated, { type: "ws/open.result", ok: true });
    expect(ok.state.publicState.status).toBe("connected");
    expect(ok.commands.some((c) => c.type === "cmd/telemetry.send")).toBe(true);
  });

  it("covers additional github-session reducer branches for ignored pendings and reconnect failures", () => {
    const user = makeUser({ githubUserId: "1", login: "alice" });
    const base = initialChatClientCoreState();

    const pendingExchange: ChatClientCoreState = {
      ...base,
      pending: {
        type: "pending/connect.exchange",
        origin: "user",
        backendUrl: "http://example.test",
        githubAccountId: "acct",
        accessToken: "gh",
        usedCachedSession: false,
        recovered: false,
      },
    };
    const ignoredExchange = handleGithubSessionResult(pendingExchange, {
      type: "github/session.result",
      ok: true,
      session: { githubAccountId: "acct", accessToken: "gh" },
      nowMs: 1,
    });
    expect(ignoredExchange.commands).toEqual([]);
    expect(ignoredExchange.state).toBe(pendingExchange);

    const pendingAuthNoBackend: ChatClientCoreState = {
      ...base,
      publicState: {
        authStatus: "signedIn",
        status: "connected",
        user,
      },
      githubAccountId: "acct",
      pending: { type: "pending/auth", interactive: false },
    };
    const accountChangedNoBackend = handleGithubSessionResult(pendingAuthNoBackend, {
      type: "github/session.result",
      ok: true,
      session: { githubAccountId: "acct2", accessToken: "gh2" },
      nowMs: 1,
    });
    expect(accountChangedNoBackend.state.publicState.status).toBe("disconnected");
    expect("backendUrl" in accountChangedNoBackend.state.publicState).toBe(false);

    const reconnectFailurePending: ChatClientCoreState = {
      ...base,
      pending: {
        type: "pending/connect.session",
        origin: "reconnect",
        backendUrl: "http://example.test",
        interactive: false,
      },
    };
    const reconnectFailure = handleGithubSessionResult(reconnectFailurePending, {
      type: "github/session.result",
      ok: false,
      nowMs: 1,
    });
    expect(reconnectFailure.commands.some((c) => c.type === "cmd/raise")).toBe(false);
    expect(reconnectFailure.state.publicState.backendUrl).toBeUndefined();

    const userFailureWithError = handleGithubSessionResult(
      {
        ...reconnectFailurePending,
        pending: { ...reconnectFailurePending.pending, origin: "user" },
      },
      {
        type: "github/session.result",
        ok: false,
        nowMs: 1,
        error: new Error("session_failed"),
      },
    );
    const raise = userFailureWithError.commands.find((c) => c.type === "cmd/raise");
    expect(raise && "error" in raise ? String(raise.error) : "").toContain("session_failed");

    const accountSwitchedConnect: ChatClientCoreState = {
      ...base,
      githubAccountId: "acct",
      cachedSession: {
        githubAccountId: "acct",
        token: "token",
        expiresAtMs: 999_999_999,
        user,
      },
      pending: {
        type: "pending/connect.session",
        origin: "user",
        backendUrl: "http://example.test",
        interactive: false,
      },
    };
    const switched = handleGithubSessionResult(accountSwitchedConnect, {
      type: "github/session.result",
      ok: true,
      session: { githubAccountId: "acct2", accessToken: "gh" },
      nowMs: 1,
    });
    expect(switched.state.cachedSession).toBeUndefined();
    expect(switched.state.pending?.type).toBe("pending/connect.exchange");

    const authMissingNonInteractive = handleGithubSessionResult(
      {
        ...base,
        pending: { type: "pending/auth", interactive: false },
      },
      {
        type: "github/session.result",
        ok: false,
        nowMs: 1,
      },
    );
    expect(authMissingNonInteractive.commands.some((c) => c.type === "cmd/raise")).toBe(false);

    const authMissingInteractiveDefaultError = handleGithubSessionResult(
      {
        ...base,
        pending: { type: "pending/auth", interactive: true },
      },
      {
        type: "github/session.result",
        ok: false,
        nowMs: 1,
      },
    );
    expect(
      authMissingInteractiveDefaultError.commands.some(
        (c) =>
          c.type === "cmd/raise" &&
          c.error instanceof Error &&
          c.error.message.includes("github_session_missing"),
      ),
    ).toBe(true);

    const authOkNonInteractive = handleGithubSessionResult(
      {
        ...base,
        pending: { type: "pending/auth", interactive: false },
      },
      {
        type: "github/session.result",
        ok: true,
        session: { githubAccountId: "acct", accessToken: "gh" },
        nowMs: 1,
      },
    );
    expect(authOkNonInteractive.state.authSuppressedByUser).toBe(base.authSuppressedByUser);

    const interactiveConnectFailure = handleGithubSessionResult(
      {
        ...base,
        pending: {
          type: "pending/connect.session",
          origin: "user",
          backendUrl: "http://interactive.test",
          interactive: true,
        },
      },
      {
        type: "github/session.result",
        ok: false,
        nowMs: 1,
      },
    );
    expect(interactiveConnectFailure.state.publicState.backendUrl).toBe("http://interactive.test");
    expect(
      interactiveConnectFailure.commands.some(
        (c) =>
          c.type === "cmd/raise" &&
          c.error instanceof Error &&
          c.error.message.includes("github_session_missing"),
      ),
    ).toBe(true);

    const cachedMismatch: ChatClientCoreState = {
      ...base,
      cachedSession: {
        githubAccountId: "acct-other",
        token: "token",
        expiresAtMs: 999_999_999,
        user,
      },
      pending: {
        type: "pending/connect.session",
        origin: "user",
        backendUrl: "http://example.test",
        interactive: false,
      },
    };
    const mismatchResult = handleGithubSessionResult(cachedMismatch, {
      type: "github/session.result",
      ok: true,
      session: { githubAccountId: "acct", accessToken: "gh" },
      nowMs: 1,
    });
    expect(mismatchResult.state.pending?.type).toBe("pending/connect.exchange");

    const ignoredPendingWs = handleGithubSessionResult(
      {
        ...base,
        pending: {
          type: "pending/connect.ws",
          origin: "user",
          backendUrl: "http://example.test",
          githubAccountId: "acct",
          accessToken: "gh",
          token: "t",
          user,
          usedCachedSession: false,
          recovered: false,
        },
      },
      {
        type: "github/session.result",
        ok: true,
        session: { githubAccountId: "acct", accessToken: "gh" },
        nowMs: 1,
      },
    );
    expect(ignoredPendingWs.commands).toEqual([]);
  });

  it("covers additional ws-open reducer branches for ignored pending and non-429 handshakes", () => {
    const user = makeUser({ githubUserId: "1", login: "alice" });
    const base = initialChatClientCoreState();

    const ignored = handleWsOpenResult(base, {
      type: "ws/open.result",
      ok: false,
      error: { type: "network_error" },
    });
    expect(ignored.state).toBe(base);
    expect(ignored.commands).toEqual([]);

    const reconnectPending: ChatClientCoreState = {
      ...base,
      reconnectAttempt: 1,
      pending: {
        type: "pending/connect.ws",
        origin: "reconnect",
        backendUrl: "http://example.test",
        githubAccountId: "acct",
        accessToken: "gh",
        token: "t",
        user,
        usedCachedSession: false,
        recovered: false,
      },
    };

    const legacyRateLimited = handleWsOpenResult(reconnectPending, {
      type: "ws/open.result",
      ok: false,
      error: {
        type: "handshake_http_error",
        status: 429,
        bodyText: "Too many connection attempts",
      },
    });
    expect(legacyRateLimited.commands.some((c) => c.type === "cmd/reconnect.schedule")).toBe(true);
    expect(
      legacyRateLimited.commands.some(
        (c) => c.type === "cmd/telemetry.send" && c.event.name === "vscodeChat.ws.legacy_fallback",
      ),
    ).toBe(true);

    const userUnknown429 = handleWsOpenResult(
      { ...reconnectPending, pending: { ...reconnectPending.pending, origin: "user" } },
      {
        type: "ws/open.result",
        ok: false,
        error: { type: "handshake_http_error", status: 429 },
      },
    );
    expect(
      userUnknown429.commands.some(
        (c) =>
          c.type === "cmd/raise" &&
          c.error instanceof Error &&
          c.error.message.includes("HTTP 429"),
      ),
    ).toBe(true);

    const userHandshake403 = handleWsOpenResult(
      { ...reconnectPending, pending: { ...reconnectPending.pending, origin: "user" } },
      {
        type: "ws/open.result",
        ok: false,
        error: { type: "handshake_http_error", status: 403 },
      },
    );
    expect(
      userHandshake403.commands.some(
        (c) =>
          c.type === "cmd/raise" &&
          c.error instanceof Error &&
          c.error.message.includes("ws_connect_failed"),
      ),
    ).toBe(true);

    const reconnectHandshake403 = handleWsOpenResult(reconnectPending, {
      type: "ws/open.result",
      ok: false,
      error: { type: "handshake_http_error", status: 403 },
    });
    expect(reconnectHandshake403.commands.some((c) => c.type === "cmd/raise")).toBe(false);
  });
});
