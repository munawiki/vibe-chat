import { describe, expect, it } from "vitest";
import type { DmMessageCipher, GithubUserId } from "@vscode-chat/protocol";
import { DmRoom } from "../src/dm/dmRoom.js";

class MemoryStorage {
  private readonly data = new Map<string, unknown>();
  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.data.get(key) as T | undefined);
  }
  put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
}

class FakeDurableObjectState {
  readonly storage = new MemoryStorage();
}

function base64OfLength(bytes: number): string {
  return btoa("a".repeat(bytes));
}

function makeCipherMessage(): DmMessageCipher {
  return {
    id: "msg-1",
    dmId: "dm:v1:1:2" as import("@vscode-chat/protocol").DmId,
    sender: {
      githubUserId: "1" as GithubUserId,
      login: "alice",
      avatarUrl: "https://example.test/alice.png",
      roles: [],
    },
    recipientGithubUserId: "2" as GithubUserId,
    senderIdentity: { cipherSuite: "nacl.box.v1", publicKey: base64OfLength(32) },
    recipientIdentity: { cipherSuite: "nacl.box.v1", publicKey: base64OfLength(32) },
    nonce: base64OfLength(24),
    ciphertext: base64OfLength(48),
    createdAt: new Date().toISOString(),
  };
}

describe("DmRoom", () => {
  it("supports /history and /append", async () => {
    const state = new FakeDurableObjectState() as unknown as DurableObjectState;
    const room = new DmRoom(state, {});

    const method = await room.fetch(new Request("https://dm-room/history", { method: "POST" }));
    expect(method.status).toBe(405);

    const empty = await room.fetch(new Request("https://dm-room/history"));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ history: [] });

    const invalidJson = await room.fetch(
      new Request("https://dm-room/append", { method: "POST", body: "{" }),
    );
    expect(invalidJson.status).toBe(400);

    const invalidPayload = await room.fetch(
      new Request("https://dm-room/append", { method: "POST", body: JSON.stringify({}) }),
    );
    expect(invalidPayload.status).toBe(400);

    const ok = await room.fetch(
      new Request("https://dm-room/append", {
        method: "POST",
        body: JSON.stringify(makeCipherMessage()),
      }),
    );
    expect(ok.status).toBe(204);

    const after = await room.fetch(new Request("https://dm-room/history"));
    expect(after.status).toBe(200);
    const json: { history: unknown[] } = await after.json();
    expect(json.history.length).toBe(1);

    const notFound = await room.fetch(new Request("https://dm-room/nope"));
    expect(notFound.status).toBe(404);
  });
});
