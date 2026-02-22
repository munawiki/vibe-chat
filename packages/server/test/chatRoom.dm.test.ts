import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  dmIdFromParticipants,
  type AuthUser,
  type DmIdentity,
  type DmMessageCipher,
  type GithubUserId,
  type ServerEvent,
} from "@vscode-chat/protocol";

const verifySessionTokenMock = vi.hoisted(() => vi.fn());
vi.mock("../src/session.js", () => ({
  verifySessionToken: verifySessionTokenMock,
}));

import { ChatRoom } from "../src/room/chatRoom.js";

type StoredAttachment = { user: AuthUser };

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

class FakeWebSocket {
  private attachment: unknown;
  readonly sent: string[] = [];
  readonly closed: Array<{ code: number; reason: string }> = [];

  serializeAttachment(attachment: unknown): void {
    this.attachment = attachment;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  send(data: string): void {
    this.sent.push(String(data));
  }

  close(code: number, reason: string): void {
    this.closed.push({ code, reason });
  }
}

class FakeDurableObjectState {
  readonly storage = new MemoryStorage();
  private sockets: WebSocket[] = [];

  getWebSockets(): WebSocket[] {
    return this.sockets.slice();
  }

  acceptWebSocket(ws: WebSocket): void {
    this.sockets = [...this.sockets, ws];
  }
}

type GlobalWithWebSocketPair = typeof globalThis & { WebSocketPair?: unknown };

function makeUser(options: { githubUserId: string; roles?: AuthUser["roles"] }): AuthUser {
  return {
    githubUserId: options.githubUserId as GithubUserId,
    login: `user-${options.githubUserId}`,
    avatarUrl: `https://example.test/${options.githubUserId}.png`,
    roles: options.roles ?? [],
  };
}

function base64OfLength(bytes: number, seed: number): string {
  const char = String.fromCharCode(97 + (seed % 26));
  return btoa(char.repeat(bytes));
}

function makeIdentity(seed: number): DmIdentity {
  return { cipherSuite: "nacl.box.v1", publicKey: base64OfLength(32, seed) };
}

function makeNonce(seed: number): string {
  return base64OfLength(24, seed);
}

function makeCiphertext(seed: number): string {
  return base64OfLength(32, seed);
}

function parseSent(ws: FakeWebSocket): ServerEvent[] {
  return ws.sent
    .map((s) => {
      try {
        return JSON.parse(s) as ServerEvent;
      } catch {
        return undefined;
      }
    })
    .filter((e): e is ServerEvent => Boolean(e));
}

describe("ChatRoom DM flows", () => {
  it("publishes identities, opens DM with history, and broadcasts DM messages", async () => {
    vi.useFakeTimers();

    const prevPair = (globalThis as unknown as GlobalWithWebSocketPair).WebSocketPair;

    class WebSocketPair {
      0: WebSocket;
      1: WebSocket;
      constructor() {
        this[0] = new FakeWebSocket() as unknown as WebSocket;
        this[1] = new FakeWebSocket() as unknown as WebSocket;
      }
    }

    (globalThis as unknown as GlobalWithWebSocketPair).WebSocketPair = WebSocketPair;

    try {
      const alice = makeUser({ githubUserId: "1" });
      const bob = makeUser({ githubUserId: "2" });

      verifySessionTokenMock.mockImplementation((token: string) => {
        if (token === "t1") return Promise.resolve(alice);
        if (token === "t2") return Promise.resolve(bob);
        return Promise.reject(new Error("invalid token"));
      });

      const dmId = dmIdFromParticipants(alice.githubUserId, bob.githubUserId);
      const history: DmMessageCipher[] = [
        {
          id: "m1",
          dmId,
          sender: alice,
          recipientGithubUserId: bob.githubUserId,
          senderIdentity: makeIdentity(1),
          recipientIdentity: makeIdentity(2),
          nonce: makeNonce(1),
          ciphertext: makeCiphertext(1),
          createdAt: new Date().toISOString(),
        },
      ];

      const dmFetchCalls: Array<{ url: string; init?: RequestInit }> = [];
      const toUrlString = (input: RequestInfo | URL): string => {
        if (typeof input === "string") return input;
        if (input instanceof URL) return input.toString();
        return input.url;
      };
      const dmStub = {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const url = toUrlString(input);
          dmFetchCalls.push(init ? { url, init } : { url });
          if (url.includes("/history"))
            return Promise.resolve(new Response(JSON.stringify({ history }), { status: 200 }));
          if (url.includes("/append")) return Promise.resolve(new Response("ok", { status: 200 }));
          return Promise.resolve(new Response("missing", { status: 404 }));
        },
      };

      const state = new FakeDurableObjectState() as unknown as DurableObjectState;
      const env = {
        DM_ROOM: {
          idFromName: (name: string) => name,
          get: () => dmStub,
        },
        SESSION_SECRET: "x".repeat(32),
      } as unknown as ConstructorParameters<typeof ChatRoom>[1];

      const room = new ChatRoom(state, env);

      await room
        .fetch(
          new Request("https://example.test/ws", {
            headers: { Upgrade: "websocket", Authorization: "Bearer t1" },
          }),
        )
        .catch((err: unknown) => expect(err).toBeInstanceOf(RangeError));

      await room
        .fetch(
          new Request("https://example.test/ws", {
            headers: { Upgrade: "websocket", Authorization: "Bearer t2" },
          }),
        )
        .catch((err: unknown) => expect(err).toBeInstanceOf(RangeError));

      const sockets = (state as unknown as FakeDurableObjectState).getWebSockets();
      expect(sockets.length).toBe(2);

      const aliceSocket = sockets[0];
      const bobSocket = sockets[1];
      if (!aliceSocket || !bobSocket) throw new Error("missing sockets");
      const aliceWs = aliceSocket as unknown as FakeWebSocket;
      const bobWs = bobSocket as unknown as FakeWebSocket;

      await room.webSocketMessage(
        bobSocket,
        JSON.stringify({
          version: PROTOCOL_VERSION,
          type: "client/dm.identity.publish",
          identity: makeIdentity(2),
        }),
      );

      await room.webSocketMessage(
        aliceSocket,
        JSON.stringify({
          version: PROTOCOL_VERSION,
          type: "client/dm.open",
          targetGithubUserId: bob.githubUserId,
        }),
      );

      const dmWelcome = parseSent(aliceWs).find((e) => e.type === "server/dm.welcome");
      expect(dmWelcome?.type).toBe("server/dm.welcome");
      expect((dmWelcome as Extract<ServerEvent, { type: "server/dm.welcome" }>).dmId).toBe(dmId);
      expect(
        (dmWelcome as Extract<ServerEvent, { type: "server/dm.welcome" }>).peerIdentity?.publicKey,
      ).toBe(makeIdentity(2).publicKey);

      await room.webSocketMessage(
        aliceSocket,
        JSON.stringify({
          version: PROTOCOL_VERSION,
          type: "client/dm.message.send",
          dmId,
          recipientGithubUserId: bob.githubUserId,
          senderIdentity: makeIdentity(1),
          recipientIdentity: makeIdentity(2),
          nonce: makeNonce(9),
          ciphertext: makeCiphertext(9),
        }),
      );

      expect(parseSent(aliceWs).some((e) => e.type === "server/dm.message.new")).toBe(true);
      expect(parseSent(bobWs).some((e) => e.type === "server/dm.message.new")).toBe(true);

      const appendCall = dmFetchCalls.find((c) => c.url.includes("/append"));
      expect(appendCall?.init?.method).toBe("POST");

      vi.runAllTimers();
    } finally {
      (globalThis as unknown as GlobalWithWebSocketPair).WebSocketPair = prevPair;
      vi.useRealTimers();
      verifySessionTokenMock.mockReset();
    }
  });

  it("rejects invalid DM payloads", async () => {
    const alice = makeUser({ githubUserId: "1" });
    verifySessionTokenMock.mockResolvedValue(alice);

    const state = new FakeDurableObjectState() as unknown as DurableObjectState;
    const env = {
      DM_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: () =>
            Promise.resolve(new Response(JSON.stringify({ history: [] }), { status: 200 })),
        }),
      },
      SESSION_SECRET: "x".repeat(32),
    } as unknown as ConstructorParameters<typeof ChatRoom>[1];

    const room = new ChatRoom(state, env);

    const ws = new FakeWebSocket();
    ws.serializeAttachment({ user: alice } satisfies StoredAttachment);
    (state as unknown as FakeDurableObjectState).acceptWebSocket(ws as unknown as WebSocket);

    await room.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/dm.message.send",
        dmId: "invalid" as unknown as string,
        recipientGithubUserId: "2",
        senderIdentity: makeIdentity(1),
        recipientIdentity: makeIdentity(2),
        nonce: makeNonce(1),
        ciphertext: makeCiphertext(1),
      }),
    );

    const error1 = parseSent(ws).find((e) => e.type === "server/error");
    expect(error1?.type).toBe("server/error");
    expect((error1 as Extract<ServerEvent, { type: "server/error" }>).code).toBe("invalid_payload");

    verifySessionTokenMock.mockReset();
  });

  it("rejects DM self-open and non-participant DM sends with stable error codes", async () => {
    const alice = makeUser({ githubUserId: "1" });
    const bob = makeUser({ githubUserId: "2" });
    const carol = makeUser({ githubUserId: "3" });
    verifySessionTokenMock.mockResolvedValue(carol);

    const state = new FakeDurableObjectState() as unknown as DurableObjectState;
    const env = {
      DM_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: () =>
            Promise.resolve(new Response(JSON.stringify({ history: [] }), { status: 200 })),
        }),
      },
      SESSION_SECRET: "x".repeat(32),
    } as unknown as ConstructorParameters<typeof ChatRoom>[1];

    const room = new ChatRoom(state, env);
    const ws = new FakeWebSocket();
    ws.serializeAttachment({ user: carol } satisfies StoredAttachment);
    (state as unknown as FakeDurableObjectState).acceptWebSocket(ws as unknown as WebSocket);

    await room.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/dm.open",
        targetGithubUserId: carol.githubUserId,
      }),
    );

    await room.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/dm.message.send",
        dmId: dmIdFromParticipants(alice.githubUserId, bob.githubUserId),
        recipientGithubUserId: bob.githubUserId,
        senderIdentity: makeIdentity(1),
        recipientIdentity: makeIdentity(2),
        nonce: makeNonce(3),
        ciphertext: makeCiphertext(3),
      }),
    );

    const errors = parseSent(ws).filter(
      (e): e is Extract<ServerEvent, { type: "server/error" }> => e.type === "server/error",
    );
    expect(errors[0]?.code).toBe("invalid_payload");
    expect(errors[0]?.message).toBe("Cannot DM self");
    expect(errors[1]?.code).toBe("forbidden");
    expect(errors[1]?.message).toBe("Not a DM participant");

    verifySessionTokenMock.mockReset();
  });

  it("preserves invalid_payload semantics on DM recipient mismatch", async () => {
    const alice = makeUser({ githubUserId: "1" });
    const bob = makeUser({ githubUserId: "2" });
    verifySessionTokenMock.mockResolvedValue(alice);

    const state = new FakeDurableObjectState() as unknown as DurableObjectState;
    const env = {
      DM_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: () =>
            Promise.resolve(new Response(JSON.stringify({ history: [] }), { status: 200 })),
        }),
      },
      SESSION_SECRET: "x".repeat(32),
    } as unknown as ConstructorParameters<typeof ChatRoom>[1];

    const room = new ChatRoom(state, env);

    const ws = new FakeWebSocket();
    ws.serializeAttachment({ user: alice } satisfies StoredAttachment);
    (state as unknown as FakeDurableObjectState).acceptWebSocket(ws as unknown as WebSocket);

    await room.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/dm.message.send",
        dmId: dmIdFromParticipants(alice.githubUserId, bob.githubUserId),
        recipientGithubUserId: "999" as GithubUserId,
        senderIdentity: makeIdentity(1),
        recipientIdentity: makeIdentity(2),
        nonce: makeNonce(1),
        ciphertext: makeCiphertext(1),
      }),
    );

    const error = parseSent(ws).find((e) => e.type === "server/error");
    expect(error?.type).toBe("server/error");
    expect((error as Extract<ServerEvent, { type: "server/error" }>).code).toBe("invalid_payload");
    expect(parseSent(ws).some((e) => e.type === "server/dm.message.new")).toBe(false);

    verifySessionTokenMock.mockReset();
  });

  it("keeps centralized forbidden server/error semantics for moderation commands", async () => {
    const state = new FakeDurableObjectState() as unknown as DurableObjectState;
    const env = {
      DM_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: () =>
            Promise.resolve(new Response(JSON.stringify({ history: [] }), { status: 200 })),
        }),
      },
      SESSION_SECRET: "x".repeat(32),
    } as unknown as ConstructorParameters<typeof ChatRoom>[1];

    const room = new ChatRoom(state, env);

    const nonModerator = makeUser({ githubUserId: "10", roles: [] });
    const nonModWs = new FakeWebSocket();
    nonModWs.serializeAttachment({ user: nonModerator } satisfies StoredAttachment);
    (state as unknown as FakeDurableObjectState).acceptWebSocket(nonModWs as unknown as WebSocket);

    await room.webSocketMessage(
      nonModWs as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/moderation.user.deny",
        targetGithubUserId: "11",
      }),
    );
    await room.webSocketMessage(
      nonModWs as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/moderation.user.allow",
        targetGithubUserId: "11",
      }),
    );

    const nonModErrors = parseSent(nonModWs).filter(
      (e): e is Extract<ServerEvent, { type: "server/error" }> => e.type === "server/error",
    );
    expect(nonModErrors).toHaveLength(2);
    expect(nonModErrors.every((e) => e.code === "forbidden")).toBe(true);
    expect(nonModErrors.every((e) => e.message === "Moderator role required.")).toBe(true);

    const moderator = makeUser({ githubUserId: "20", roles: ["moderator"] });
    const moderatorWs = new FakeWebSocket();
    moderatorWs.serializeAttachment({ user: moderator } satisfies StoredAttachment);
    (state as unknown as FakeDurableObjectState).acceptWebSocket(
      moderatorWs as unknown as WebSocket,
    );

    await room.webSocketMessage(
      moderatorWs as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/moderation.user.deny",
        targetGithubUserId: moderator.githubUserId,
      }),
    );
    await room.webSocketMessage(
      moderatorWs as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/moderation.user.allow",
        targetGithubUserId: moderator.githubUserId,
      }),
    );

    const selfErrors = parseSent(moderatorWs).filter(
      (e): e is Extract<ServerEvent, { type: "server/error" }> => e.type === "server/error",
    );
    expect(selfErrors).toHaveLength(2);
    expect(selfErrors[0]?.code).toBe("forbidden");
    expect(selfErrors[0]?.message).toBe("Self-ban is not allowed.");
    expect(selfErrors[1]?.code).toBe("forbidden");
    expect(selfErrors[1]?.message).toBe("Self-unban is not applicable.");
  });

  it("rate-limits DM sends with centralized server/error policy", async () => {
    const alice = makeUser({ githubUserId: "1" });
    const bob = makeUser({ githubUserId: "2" });
    verifySessionTokenMock.mockResolvedValue(alice);

    const state = new FakeDurableObjectState() as unknown as DurableObjectState;
    const env = {
      DM_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: (input: RequestInfo | URL) => {
            const url =
              typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.toString()
                  : input.url;
            if (url.includes("/append"))
              return Promise.resolve(new Response("ok", { status: 200 }));
            return Promise.resolve(new Response(JSON.stringify({ history: [] }), { status: 200 }));
          },
        }),
      },
      SESSION_SECRET: "x".repeat(32),
      CHAT_MESSAGE_RATE_WINDOW_MS: "1000",
      CHAT_MESSAGE_RATE_MAX_COUNT: "1",
    } as unknown as ConstructorParameters<typeof ChatRoom>[1];

    const room = new ChatRoom(state, env);

    const ws = new FakeWebSocket();
    ws.serializeAttachment({ user: alice } satisfies StoredAttachment);
    (state as unknown as FakeDurableObjectState).acceptWebSocket(ws as unknown as WebSocket);

    const dmId = dmIdFromParticipants(alice.githubUserId, bob.githubUserId);
    const payload = {
      version: PROTOCOL_VERSION,
      type: "client/dm.message.send" as const,
      dmId,
      recipientGithubUserId: bob.githubUserId,
      senderIdentity: makeIdentity(1),
      recipientIdentity: makeIdentity(2),
      nonce: makeNonce(1),
      ciphertext: makeCiphertext(1),
    };

    await room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(payload));
    await room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(payload));

    const errors = parseSent(ws).filter((e) => e.type === "server/error");
    expect(errors.length).toBeGreaterThan(0);
    expect((errors.at(-1) as Extract<ServerEvent, { type: "server/error" }>).code).toBe(
      "rate_limited",
    );

    verifySessionTokenMock.mockReset();
  });
});
