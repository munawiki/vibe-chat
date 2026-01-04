import { describe, expect, it } from "vitest";
import { AuthUserSchema } from "@vscode-chat/protocol";
import type { AuthUser } from "@vscode-chat/protocol";
import { derivePresenceSnapshotFromWebSockets } from "../src/presence.js";

type WebSocketLike = Parameters<typeof derivePresenceSnapshotFromWebSockets>[0][number];

function makeUser(
  overrides: Pick<AuthUser, "login"> &
    Partial<Omit<AuthUser, "login" | "roles" | "githubUserId">> & { githubUserId: string },
): AuthUser {
  return AuthUserSchema.parse({
    avatarUrl: "https://example.com/avatar.png",
    roles: [],
    ...overrides,
  });
}

function makeWebSocket(user: AuthUser): WebSocketLike {
  return { deserializeAttachment: () => ({ user }) };
}

const alice = makeUser({
  githubUserId: "1",
  login: "alice",
  avatarUrl: "https://example.com/alice.png",
});

const bob = makeUser({
  githubUserId: "2",
  login: "bob",
  avatarUrl: "https://example.com/bob.png",
});

describe("derivePresenceSnapshotFromWebSockets", () => {
  it("groups by githubUserId with connection counts", () => {
    const ws1 = makeWebSocket(alice);
    const ws2 = makeWebSocket(alice);
    const ws3 = makeWebSocket(bob);

    const snapshot = derivePresenceSnapshotFromWebSockets([ws3, ws1, ws2]);

    expect(snapshot).toEqual([
      { user: alice, connections: 2 },
      { user: bob, connections: 1 },
    ]);
  });

  it("excludes the provided socket (best-effort close behavior)", () => {
    const ws1 = makeWebSocket(alice);
    const ws2 = makeWebSocket(alice);

    const snapshot = derivePresenceSnapshotFromWebSockets([ws1, ws2], { exclude: ws2 });

    expect(snapshot).toEqual([{ user: alice, connections: 1 }]);
  });

  it("supports excluding multiple sockets", () => {
    const ws1 = makeWebSocket(alice);
    const ws2 = makeWebSocket(alice);
    const ws3 = makeWebSocket(alice);

    const snapshot = derivePresenceSnapshotFromWebSockets([ws1, ws2, ws3], {
      exclude: new Set([ws1, ws3]),
    });

    expect(snapshot).toEqual([{ user: alice, connections: 1 }]);
  });

  it("ignores sockets with invalid attachments", () => {
    const ws1 = { deserializeAttachment: () => ({}) };
    const ws2 = { deserializeAttachment: () => null };
    const ws3 = {
      deserializeAttachment: () => {
        throw new Error("boom");
      },
    };

    const snapshot = derivePresenceSnapshotFromWebSockets([ws1, ws2, ws3]);

    expect(snapshot).toEqual([]);
  });
});
