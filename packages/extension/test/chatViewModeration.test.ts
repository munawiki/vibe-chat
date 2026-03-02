import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@vscode-chat/protocol";
import type { AuthUser, GithubUserId, ServerEvent } from "@vscode-chat/protocol";
import type { ChatClientState } from "../src/net/chatClient.js";
import { ChatViewModeration } from "../src/ui/chatView/moderation.js";
import { createMockAuthUser } from "./helpers/mockAuthUser.js";

function makeUser(options: { githubUserId: string; roles?: AuthUser["roles"] }): AuthUser {
  return createMockAuthUser({
    githubUserId: options.githubUserId,
    login: "alice",
    roles: options.roles,
  }) as AuthUser;
}

describe("ChatViewModeration", () => {
  it("rejects actions when not connected or not a moderator", () => {
    const moderation = new ChatViewModeration();

    const disconnected: ChatClientState = { authStatus: "signedOut", status: "disconnected" };
    const r1 = moderation.handleUiAction("deny", "2" as GithubUserId, disconnected);
    expect(r1.outbound.phase).toBe("error");

    const connectedNotMod: ChatClientState = {
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user: makeUser({ githubUserId: "1", roles: [] }),
    };
    const r2 = moderation.handleUiAction("deny", "2" as GithubUserId, connectedNotMod);
    expect(r2.outbound.phase).toBe("error");
    expect(r2.send).toBeUndefined();
  });

  it("rejects self-ban and self-unban attempts", () => {
    const moderation = new ChatViewModeration();

    const modState: ChatClientState = {
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user: makeUser({ githubUserId: "1", roles: ["moderator"] }),
    };

    const denySelf = moderation.handleUiAction("deny", "1" as GithubUserId, modState);
    expect(denySelf.outbound.phase).toBe("error");
    expect(denySelf.outbound.message).toBe("Self-ban is not allowed.");

    const allowSelf = moderation.handleUiAction("allow", "1" as GithubUserId, modState);
    expect(allowSelf.outbound.phase).toBe("error");
    expect(allowSelf.outbound.message).toBe("Self-unban is not applicable.");
  });

  it("tracks pending actions and resolves them from server events", () => {
    const moderation = new ChatViewModeration();

    const modState: ChatClientState = {
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user: makeUser({ githubUserId: "1", roles: ["moderator"] }),
    };

    const pending = moderation.handleUiAction("deny", "2" as GithubUserId, modState);
    expect(pending.outbound.phase).toBe("pending");
    expect(pending.send).toEqual({ action: "deny", targetGithubUserId: "2" });

    const snapshotMsg = moderation.handleServerSnapshot({
      version: PROTOCOL_VERSION,
      type: "server/moderation.snapshot",
      operatorDeniedGithubUserIds: ["3" as GithubUserId],
      roomDeniedGithubUserIds: [],
    });
    expect(snapshotMsg.operatorDeniedGithubUserIds).toEqual(["3"]);
    expect(moderation.getSnapshotMessage()?.type).toBe("ext/moderation.snapshot");

    const deniedEvent: Extract<ServerEvent, { type: "server/moderation.user.denied" }> = {
      version: PROTOCOL_VERSION,
      type: "server/moderation.user.denied",
      actorGithubUserId: "1" as GithubUserId,
      targetGithubUserId: "2" as GithubUserId,
    };
    const denied = moderation.handleServerUserDenied(deniedEvent, modState);
    expect(denied.userMessage.type).toBe("ext/moderation.user.denied");
    expect(denied.resolved?.phase).toBe("success");

    const errorEvent: Extract<ServerEvent, { type: "server/error" }> = {
      version: PROTOCOL_VERSION,
      type: "server/error",
      code: "forbidden",
      message: "nope",
    };
    expect(moderation.handleServerError(errorEvent)).toBeUndefined();
  });

  it("updates the snapshot on allow events and resolves pending allow actions", () => {
    const moderation = new ChatViewModeration();

    const modState: ChatClientState = {
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user: makeUser({ githubUserId: "1", roles: ["moderator"] }),
    };

    moderation.handleServerSnapshot({
      version: PROTOCOL_VERSION,
      type: "server/moderation.snapshot",
      operatorDeniedGithubUserIds: [],
      roomDeniedGithubUserIds: ["2" as GithubUserId],
    });

    const pending = moderation.handleUiAction("allow", "2" as GithubUserId, modState);
    expect(pending.outbound.phase).toBe("pending");

    const allowedEvent: Extract<ServerEvent, { type: "server/moderation.user.allowed" }> = {
      version: PROTOCOL_VERSION,
      type: "server/moderation.user.allowed",
      actorGithubUserId: "1" as GithubUserId,
      targetGithubUserId: "2" as GithubUserId,
    };
    const allowed = moderation.handleServerUserAllowed(allowedEvent, modState);
    expect(allowed.userMessage.type).toBe("ext/moderation.user.allowed");
    expect(allowed.resolved?.phase).toBe("success");
    expect(moderation.getSnapshotMessage()?.roomDeniedGithubUserIds).toEqual([]);
  });

  it("emits an error resolution when a pending action fails", () => {
    const moderation = new ChatViewModeration();

    const modState: ChatClientState = {
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user: makeUser({ githubUserId: "1", roles: ["moderator"] }),
    };

    moderation.handleUiAction("allow", "2" as GithubUserId, modState);

    const errorEvent: Extract<ServerEvent, { type: "server/error" }> = {
      version: PROTOCOL_VERSION,
      type: "server/error",
      code: "forbidden",
      message: "nope",
    };
    const msg = moderation.handleServerError(errorEvent);
    expect(msg?.phase).toBe("error");
    expect(moderation.handleServerError(errorEvent)).toBeUndefined();
  });

  it("keeps a pending action when actor mismatches and uses server/error code as a fallback message", () => {
    const moderation = new ChatViewModeration();

    const modState: ChatClientState = {
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user: makeUser({ githubUserId: "1", roles: ["moderator"] }),
    };

    moderation.handleUiAction("deny", "2" as GithubUserId, modState);

    const deniedEvent: Extract<ServerEvent, { type: "server/moderation.user.denied" }> = {
      version: PROTOCOL_VERSION,
      type: "server/moderation.user.denied",
      actorGithubUserId: "999" as GithubUserId,
      targetGithubUserId: "2" as GithubUserId,
    };
    const denied = moderation.handleServerUserDenied(deniedEvent, modState);
    expect(denied.resolved).toBeUndefined();

    const errorEvent: Extract<ServerEvent, { type: "server/error" }> = {
      version: PROTOCOL_VERSION,
      type: "server/error",
      code: "forbidden",
    };
    const msg = moderation.handleServerError(errorEvent);
    expect(msg?.phase).toBe("error");
    expect(msg?.message).toBe("forbidden");
  });
});
