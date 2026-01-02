import { describe, expect, it } from "vitest";
import { derivePresenceSnapshotFromWebSockets } from "../src/presence.js";

describe("derivePresenceSnapshotFromWebSockets", () => {
  it("groups by githubUserId with connection counts", () => {
    const alice = {
      githubUserId: "1",
      login: "alice",
      avatarUrl: "https://example.com/alice.png",
    };
    const bob = {
      githubUserId: "2",
      login: "bob",
      avatarUrl: "https://example.com/bob.png",
    };

    const ws1 = { deserializeAttachment: () => ({ user: alice }) };
    const ws2 = { deserializeAttachment: () => ({ user: alice }) };
    const ws3 = { deserializeAttachment: () => ({ user: bob }) };

    const snapshot = derivePresenceSnapshotFromWebSockets([ws3, ws1, ws2]);

    expect(snapshot).toEqual([
      { user: alice, connections: 2 },
      { user: bob, connections: 1 },
    ]);
  });

  it("excludes the provided socket (best-effort close behavior)", () => {
    const alice = {
      githubUserId: "1",
      login: "alice",
      avatarUrl: "https://example.com/alice.png",
    };

    const ws1 = { deserializeAttachment: () => ({ user: alice }) };
    const ws2 = { deserializeAttachment: () => ({ user: alice }) };

    const snapshot = derivePresenceSnapshotFromWebSockets([ws1, ws2], { exclude: ws2 });

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
