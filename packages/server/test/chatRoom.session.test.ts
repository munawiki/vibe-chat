import { describe, expect, it, vi } from "vitest";
import { ChatRoomSession } from "../src/room/chatRoom/session.js";

describe("ChatRoomSession", () => {
  it("parses guardrails config and moderator sets", () => {
    const session = new ChatRoomSession(
      {
        log: vi.fn(),
        sendError: vi.fn(),
      },
      {
        SESSION_SECRET: "x".repeat(32),
        MODERATOR_GITHUB_USER_IDS: "1,2",
      },
    );

    const parsed = session.parseConfigOrThrow("chat_room");
    expect(parsed.guardrails.maxConnectionsPerUser).toBeGreaterThan(0);
    expect(
      parsed.moderatorGithubUserIds.has("1" as import("@vscode-chat/protocol").GithubUserId),
    ).toBe(true);
  });

  it("sends server_error when socket attachment is missing", () => {
    const sendError = vi.fn();
    const ws = {
      deserializeAttachment: () => undefined,
      close: vi.fn(),
    } as unknown as WebSocket;
    const session = new ChatRoomSession(
      {
        log: vi.fn(),
        sendError,
      },
      { SESSION_SECRET: "x".repeat(32) },
    );

    const user = session.getSocketUserOrClose(ws);
    expect(user).toBeUndefined();
    expect(sendError).toHaveBeenCalledWith(ws, {
      code: "server_error",
      message: "Missing connection identity",
    });
  });
});
