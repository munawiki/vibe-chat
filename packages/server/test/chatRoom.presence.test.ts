import { describe, expect, it, vi } from "vitest";
import { ChatRoomPresence } from "../src/room/chatRoom/presence.js";

function makeSocket(githubUserId: string, login: string): WebSocket {
  return {
    deserializeAttachment: () => ({
      user: {
        githubUserId: githubUserId as import("@vscode-chat/protocol").GithubUserId,
        login,
        avatarUrl: `https://example.test/${login}.png`,
        roles: [],
      },
    }),
  } as unknown as WebSocket;
}

describe("ChatRoomPresence", () => {
  it("broadcasts derived presence snapshot and honors exclude socket", () => {
    vi.useFakeTimers();
    try {
      const alice = makeSocket("1", "alice");
      const bob = makeSocket("2", "bob");
      const sent: import("@vscode-chat/protocol").ServerEvent[] = [];

      const presence = new ChatRoomPresence({ getWebSockets: () => [alice, bob] }, (event) =>
        sent.push(event),
      );

      presence.request({ exclude: bob });
      vi.advanceTimersByTime(250);

      const event = sent[0];
      expect(event?.type).toBe("server/presence");
      if (event?.type === "server/presence") {
        expect(event.snapshot.map((item) => item.user.login)).toEqual(["alice"]);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
