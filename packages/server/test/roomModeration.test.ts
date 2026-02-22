import { describe, expect, it } from "vitest";
import type { AuthUser, GithubUserId, ServerEvent } from "@vscode-chat/protocol";
import { ChatRoomModeration } from "../src/room/moderation.js";

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

class FakeWebSocket {
  readonly sent: string[] = [];
  readonly closed: Array<{ code: number; reason: string }> = [];

  constructor(private readonly user: AuthUser) {}

  deserializeAttachment(): unknown {
    return { user: this.user };
  }

  send(data: string): void {
    this.sent.push(String(data));
  }

  close(code: number, reason: string): void {
    this.closed.push({ code, reason });
  }
}

function makeUser(options: { githubUserId: string; roles?: AuthUser["roles"] }): AuthUser {
  return {
    githubUserId: options.githubUserId as GithubUserId,
    login: `user-${options.githubUserId}`,
    avatarUrl: `https://example.test/${options.githubUserId}.png`,
    roles: options.roles ?? [],
  };
}

describe("ChatRoomModeration", () => {
  it("rejects deny/allow when actor is not a moderator", async () => {
    const state = new FakeDurableObjectState() as unknown as DurableObjectState;
    const sockets: WebSocket[] = [];

    const errors: Array<{ code: string; message: string }> = [];
    const moderation = new ChatRoomModeration(
      state,
      new Set<GithubUserId>(),
      () => sockets,
      () => {},
      (_ws, err) => {
        errors.push({ code: err.code, message: err.message ?? err.code });
      },
      () => {},
    );

    const actor = makeUser({ githubUserId: "1", roles: [] });
    const actorWs = new FakeWebSocket(actor) as unknown as WebSocket;
    await moderation.handleUserDeny(actorWs, actor, "2" as GithubUserId);
    await moderation.handleUserAllow(actorWs, actor, "2" as GithubUserId);

    expect(errors.some((e) => e.code === "forbidden")).toBe(true);
  });

  it("persists denylist, kicks denied users, and notifies moderators", async () => {
    const state = new FakeDurableObjectState() as unknown as DurableObjectState;

    const moderator = makeUser({ githubUserId: "1", roles: ["moderator"] });
    const target = makeUser({ githubUserId: "2", roles: [] });

    const moderatorWs = new FakeWebSocket(moderator);
    const targetWs = new FakeWebSocket(target);
    const sockets: WebSocket[] = [
      moderatorWs as unknown as WebSocket,
      targetWs as unknown as WebSocket,
    ];

    const sentErrors: Array<{ ws: FakeWebSocket; code: string }> = [];
    const moderation = new ChatRoomModeration(
      state,
      new Set<GithubUserId>(),
      () => sockets,
      () => {},
      (ws, err) => {
        sentErrors.push({ ws: ws as unknown as FakeWebSocket, code: err.code });
      },
      () => {},
    );

    await moderation.handleUserDeny(
      moderatorWs as unknown as WebSocket,
      moderator,
      "2" as GithubUserId,
    );

    expect(targetWs.closed.at(-1)?.code).toBe(1008);
    expect(sentErrors.some((e) => e.ws === targetWs && e.code === "forbidden")).toBe(true);

    expect(
      moderatorWs.sent.some((s) => {
        const json = JSON.parse(s) as ServerEvent;
        return json.type === "server/moderation.user.denied";
      }),
    ).toBe(true);

    const operatorDenied = new Set<GithubUserId>(["3" as GithubUserId]);
    const errors2: Array<{ code: string; message: string }> = [];
    const moderation2 = new ChatRoomModeration(
      state,
      operatorDenied,
      () => sockets,
      () => {},
      (_ws, err) => {
        errors2.push({ code: err.code, message: err.message ?? err.code });
      },
      () => {},
    );

    await moderation2.handleUserAllow(
      moderatorWs as unknown as WebSocket,
      moderator,
      "3" as GithubUserId,
    );
    expect(errors2).toEqual([
      { code: "forbidden", message: "Operator deny cannot be overridden by moderator unban." },
    ]);
  });

  it("applies self-action guardrails and emits sorted snapshot payloads", async () => {
    const state = new FakeDurableObjectState() as unknown as DurableObjectState;
    const moderator = makeUser({ githubUserId: "9", roles: ["moderator"] });
    const moderatorWs = new FakeWebSocket(moderator);
    const sockets: WebSocket[] = [moderatorWs as unknown as WebSocket];

    const errors: Array<{ code: string; message: string }> = [];
    const moderation = new ChatRoomModeration(
      state,
      new Set<GithubUserId>(["11" as GithubUserId, "10" as GithubUserId]),
      () => sockets,
      (ws, event) => {
        (ws as unknown as FakeWebSocket).send(JSON.stringify(event));
      },
      (_ws, err) => {
        errors.push({ code: err.code, message: err.message ?? err.code });
      },
      () => {},
    );

    await moderation.handleUserDeny(
      moderatorWs as unknown as WebSocket,
      moderator,
      moderator.githubUserId,
    );
    await moderation.handleUserAllow(
      moderatorWs as unknown as WebSocket,
      moderator,
      moderator.githubUserId,
    );

    expect(errors).toEqual([
      { code: "forbidden", message: "Self-ban is not allowed." },
      { code: "forbidden", message: "Self-unban is not applicable." },
    ]);

    moderation.sendSnapshot(moderatorWs as unknown as WebSocket);
    const snapshot = moderatorWs.sent
      .map((entry) => JSON.parse(entry) as ServerEvent)
      .find((event) => event.type === "server/moderation.snapshot");
    expect(snapshot?.type).toBe("server/moderation.snapshot");
    if (snapshot?.type !== "server/moderation.snapshot") return;
    expect(snapshot.operatorDeniedGithubUserIds).toEqual(["10", "11"]);
    expect(snapshot.roomDeniedGithubUserIds).toEqual([]);
  });
});
