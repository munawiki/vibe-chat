import { describe, expect, it, vi } from "vitest";
import type { AuthUser, ServerEvent } from "@vscode-chat/protocol";
import { createServerEventRouter } from "../src/ui/chatViewProvider/serverEventRouter.js";

function makeUser(options: {
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

describe("serverEventRouter", () => {
  it("keeps pipeline ordering for message events", async () => {
    const calls: string[] = [];
    const postMessage = vi.fn((msg: unknown) => {
      const type =
        typeof msg === "object" && msg !== null && "type" in msg ? String(msg.type) : "unknown";
      calls.push(`post:${type}`);
    });

    const route = createServerEventRouter({
      client: { getState: () => ({ authStatus: "signedIn", status: "connected" }) } as never,
      onNewMessage: () => calls.push("onNewMessage"),
      postMessage,
      postError: vi.fn(),
      postDirectMessagesResult: vi.fn(),
      directMessages: {
        handleServerWelcome: vi.fn(),
        handleServerMessageNew: vi.fn(),
      } as never,
      presence: { handleServerSnapshot: vi.fn() } as never,
      moderation: {
        handleServerSnapshot: vi.fn(),
        handleServerUserDenied: vi.fn(),
        handleServerUserAllowed: vi.fn(),
        handleServerError: vi.fn(),
      } as never,
    });

    const event = {
      version: "1.0",
      type: "server/message.new",
      message: {
        id: "m1",
        user: makeUser({ githubUserId: "1", login: "alice" }),
        text: "hello",
        createdAt: new Date().toISOString(),
      },
      clientMessageId: "client-1",
    } as unknown as ServerEvent;

    await route(event);

    expect(calls).toEqual(["onNewMessage", "post:ext/message"]);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ext/message",
        clientMessageId: "client-1",
      }),
    );
  });

  it("routes direct-message handlers and forwards aggregated result payloads", async () => {
    const handleServerWelcome = vi.fn(() =>
      Promise.resolve({
        outbound: [{ type: "ext/dm.state", threads: [] }],
        history: { type: "ext/dm.history", dmId: "dm:v1:1:2", history: [] },
        error: undefined,
      }),
    );
    const handleServerMessageNew = vi.fn(() =>
      Promise.resolve({
        outbound: [{ type: "ext/dm.state", threads: [] }],
        message: {
          type: "ext/dm.message",
          message: {
            id: "dm-message",
            dmId: "dm:v1:1:2",
            user: makeUser({ githubUserId: "2", login: "bob" }),
            text: "hello",
            createdAt: new Date().toISOString(),
          },
        },
        error: "dm warning",
      }),
    );
    const postDirectMessagesResult = vi.fn();

    const route = createServerEventRouter({
      client: { getState: () => ({ authStatus: "signedIn", status: "connected" }) } as never,
      onNewMessage: vi.fn(),
      postMessage: vi.fn(),
      postError: vi.fn(),
      postDirectMessagesResult,
      directMessages: {
        handleServerWelcome,
        handleServerMessageNew,
      } as never,
      presence: { handleServerSnapshot: vi.fn() } as never,
      moderation: {
        handleServerSnapshot: vi.fn(),
        handleServerUserDenied: vi.fn(),
        handleServerUserAllowed: vi.fn(),
        handleServerError: vi.fn(),
      } as never,
    });

    await route({
      version: "1.0",
      type: "server/dm.welcome",
      dmId: "dm:v1:1:2",
      peerGithubUserId: "2",
      history: [],
    } as unknown as ServerEvent);
    await route({
      version: "1.0",
      type: "server/dm.message.new",
      message: {
        id: "dm-message",
        dmId: "dm:v1:1:2",
        user: makeUser({ githubUserId: "2", login: "bob" }),
        text: "hello",
        createdAt: new Date().toISOString(),
      },
    } as unknown as ServerEvent);

    expect(handleServerWelcome).toHaveBeenCalledTimes(1);
    expect(handleServerMessageNew).toHaveBeenCalledTimes(1);
    expect(postDirectMessagesResult).toHaveBeenCalledTimes(2);
    expect(postDirectMessagesResult).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      expect.objectContaining({ type: "ext/dm.message" }),
      "dm warning",
    );
  });

  it("handles server/error with and without clientMessageId", async () => {
    const postMessage = vi.fn();
    const postError = vi.fn();
    const moderationError = {
      type: "ext/moderation.action",
      action: "deny",
      phase: "error",
    } as const;
    const handleServerError = vi.fn(() => moderationError);

    const route = createServerEventRouter({
      client: { getState: () => ({ authStatus: "signedIn", status: "connected" }) } as never,
      onNewMessage: vi.fn(),
      postMessage,
      postError,
      postDirectMessagesResult: vi.fn(),
      directMessages: {
        handleServerWelcome: vi.fn(),
        handleServerMessageNew: vi.fn(),
      } as never,
      presence: { handleServerSnapshot: vi.fn() } as never,
      moderation: {
        handleServerSnapshot: vi.fn(),
        handleServerUserDenied: vi.fn(),
        handleServerUserAllowed: vi.fn(),
        handleServerError,
      } as never,
    });

    await route({
      version: "1.0",
      type: "server/error",
      code: "rate_limited",
      message: "Too many messages",
      clientMessageId: "client-1",
      retryAfterMs: 5000,
    } as unknown as ServerEvent);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ext/message.send.error",
        clientMessageId: "client-1",
        code: "rate_limited",
        retryAfterMs: 5000,
      }),
    );
    expect(postError).not.toHaveBeenCalled();

    await route({
      version: "1.0",
      type: "server/error",
      code: "invalid_payload",
      message: "Bad payload",
    } as unknown as ServerEvent);

    expect(handleServerError).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(moderationError);
    expect(postError).toHaveBeenCalledWith("Bad payload");
  });

  it("routes welcome, presence, and moderation snapshots through ordered handlers", async () => {
    const postMessage = vi.fn();
    const postError = vi.fn();
    const calls: string[] = [];
    const route = createServerEventRouter({
      client: { getState: () => ({ authStatus: "signedIn", status: "connected" }) } as never,
      onNewMessage: vi.fn(),
      postMessage: (msg) => {
        const t =
          typeof msg === "object" && msg !== null && "type" in msg ? String(msg.type) : "unknown";
        calls.push(t);
        postMessage(msg);
      },
      postError,
      postDirectMessagesResult: vi.fn(),
      directMessages: {
        handleServerWelcome: vi.fn(),
        handleServerMessageNew: vi.fn(),
      } as never,
      presence: {
        handleServerSnapshot: vi.fn(
          (snapshot: Extract<ServerEvent, { type: "server/presence" }>["snapshot"]) => ({
            type: "ext/presence",
            snapshot,
          }),
        ),
      } as never,
      moderation: {
        handleServerSnapshot: vi.fn(
          (event: Extract<ServerEvent, { type: "server/moderation.snapshot" }>) => ({
            type: "ext/moderation.snapshot",
            operatorDeniedGithubUserIds: event.operatorDeniedGithubUserIds,
            roomDeniedGithubUserIds: event.roomDeniedGithubUserIds,
          }),
        ),
        handleServerUserDenied: vi.fn(
          (event: Extract<ServerEvent, { type: "server/moderation.user.denied" }>) => ({
            userMessage: {
              type: "ext/moderation.user.denied",
              targetGithubUserId: event.targetGithubUserId,
              actorGithubUserId: event.actorGithubUserId,
            },
            resolved: { type: "ext/moderation.action", action: "deny", phase: "success" },
          }),
        ),
        handleServerUserAllowed: vi.fn(
          (event: Extract<ServerEvent, { type: "server/moderation.user.allowed" }>) => ({
            userMessage: {
              type: "ext/moderation.user.allowed",
              targetGithubUserId: event.targetGithubUserId,
              actorGithubUserId: event.actorGithubUserId,
            },
            resolved: { type: "ext/moderation.action", action: "allow", phase: "success" },
          }),
        ),
        handleServerError: vi.fn(),
      } as never,
    });

    const createdAt = new Date().toISOString();

    await route({
      version: "1.0",
      type: "server/welcome",
      user: makeUser({ githubUserId: "1", login: "alice" }),
      serverTime: createdAt,
      history: [],
    } as unknown as ServerEvent);
    await route({
      version: "1.0",
      type: "server/presence",
      snapshot: [{ user: makeUser({ githubUserId: "1", login: "alice" }), connections: 1 }],
    } as unknown as ServerEvent);
    await route({
      version: "1.0",
      type: "server/moderation.snapshot",
      operatorDeniedGithubUserIds: [],
      roomDeniedGithubUserIds: ["2" as import("@vscode-chat/protocol").GithubUserId],
    } as unknown as ServerEvent);
    await route({
      version: "1.0",
      type: "server/moderation.user.denied",
      targetGithubUserId: "2",
      actorGithubUserId: "1",
    } as unknown as ServerEvent);
    await route({
      version: "1.0",
      type: "server/moderation.user.allowed",
      targetGithubUserId: "2",
      actorGithubUserId: "1",
    } as unknown as ServerEvent);

    expect(postError).not.toHaveBeenCalled();
    expect(calls).toEqual([
      "ext/history",
      "ext/presence",
      "ext/moderation.snapshot",
      "ext/moderation.user.denied",
      "ext/moderation.action",
      "ext/moderation.user.allowed",
      "ext/moderation.action",
    ]);
  });

  it("falls back to error code when server/error has no message", async () => {
    const postMessage = vi.fn();
    const postError = vi.fn();

    const route = createServerEventRouter({
      client: { getState: () => ({ authStatus: "signedIn", status: "connected" }) } as never,
      onNewMessage: vi.fn(),
      postMessage,
      postError,
      postDirectMessagesResult: vi.fn(),
      directMessages: {
        handleServerWelcome: vi.fn(),
        handleServerMessageNew: vi.fn(),
      } as never,
      presence: { handleServerSnapshot: vi.fn() } as never,
      moderation: {
        handleServerSnapshot: vi.fn(),
        handleServerUserDenied: vi.fn(),
        handleServerUserAllowed: vi.fn(),
        handleServerError: vi.fn(() => undefined),
      } as never,
    });

    await route({
      version: "1.0",
      type: "server/error",
      code: "invalid_payload",
    } as unknown as ServerEvent);

    expect(postMessage).not.toHaveBeenCalled();
    expect(postError).toHaveBeenCalledWith("invalid_payload");
  });
});
