import { describe, expect, it, vi } from "vitest";
import type { AuthUser, GithubUserId, WsHandshakeRejection } from "@vscode-chat/protocol";

const verifySessionTokenMock = vi.hoisted(() => vi.fn());
vi.mock("../src/session.js", () => ({
  verifySessionToken: verifySessionTokenMock,
}));

import { ChatRoom } from "../src/room/chatRoom.js";

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

function makeUser(githubUserId: string): AuthUser {
  return {
    githubUserId: githubUserId as GithubUserId,
    login: `user-${githubUserId}`,
    avatarUrl: `https://example.test/${githubUserId}.png`,
    roles: [],
  };
}

describe("ChatRoom fetch rejections", () => {
  it("rate-limits websocket connection attempts by client IP", async () => {
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
      verifySessionTokenMock.mockResolvedValue(makeUser("1"));

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
        CHAT_CONNECT_RATE_WINDOW_MS: "1000",
        CHAT_CONNECT_RATE_MAX_COUNT: "1",
      } as unknown as ConstructorParameters<typeof ChatRoom>[1];

      const room = new ChatRoom(state, env);
      const req = new Request("https://example.test/ws", {
        headers: {
          Upgrade: "websocket",
          Authorization: "Bearer token",
          "cf-connecting-ip": "1.2.3.4",
        },
      });

      await room.fetch(req).catch((err: unknown) => expect(err).toBeInstanceOf(RangeError));

      const rateLimited = await room.fetch(req);
      expect(rateLimited.status).toBe(429);
      const body: WsHandshakeRejection = await rateLimited.json();
      expect(body.code).toBe("rate_limited");

      vi.runAllTimers();
    } finally {
      (globalThis as unknown as GlobalWithWebSocketPair).WebSocketPair = prevPair;
      vi.useRealTimers();
      verifySessionTokenMock.mockReset();
    }
  });

  it("rejects missing and invalid bearer tokens", async () => {
    const state = new FakeDurableObjectState() as unknown as DurableObjectState;
    const env = {
      DM_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }),
      },
      SESSION_SECRET: "x".repeat(32),
    } as unknown as ConstructorParameters<typeof ChatRoom>[1];

    const room = new ChatRoom(state, env);

    const missing = await room.fetch(
      new Request("https://example.test/ws", { headers: { Upgrade: "websocket" } }),
    );
    expect(missing.status).toBe(401);

    verifySessionTokenMock.mockRejectedValue(new Error("invalid"));
    const invalid = await room.fetch(
      new Request("https://example.test/ws", {
        headers: { Upgrade: "websocket", Authorization: "Bearer bad" },
      }),
    );
    expect(invalid.status).toBe(401);

    verifySessionTokenMock.mockReset();
  });

  it("rejects denied users, full rooms, and too many connections per user", async () => {
    const state = new FakeDurableObjectState() as unknown as DurableObjectState;
    const envBase = {
      DM_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }),
      },
      SESSION_SECRET: "x".repeat(32),
    } as unknown as ConstructorParameters<typeof ChatRoom>[1];

    const alice = makeUser("1");
    verifySessionTokenMock.mockResolvedValue(alice);

    const deniedRoom = new ChatRoom(state, { ...envBase, DENY_GITHUB_USER_IDS: "1" });
    const denied = await deniedRoom.fetch(
      new Request("https://example.test/ws", {
        headers: { Upgrade: "websocket", Authorization: "Bearer token" },
      }),
    );
    expect(denied.status).toBe(403);

    const fullState = new FakeDurableObjectState() as unknown as DurableObjectState;
    (fullState as unknown as FakeDurableObjectState).acceptWebSocket(
      new FakeWebSocket() as unknown as WebSocket,
    );
    const fullRoom = new ChatRoom(fullState, { ...envBase, CHAT_MAX_CONNECTIONS_PER_ROOM: "1" });
    const roomFull = await fullRoom.fetch(
      new Request("https://example.test/ws", {
        headers: { Upgrade: "websocket", Authorization: "Bearer token" },
      }),
    );
    expect(roomFull.status).toBe(429);
    const roomFullBody: WsHandshakeRejection = await roomFull.json();
    expect(roomFullBody.code).toBe("room_full");
    expect(roomFull.headers.get("retry-after")).toBeNull();
    expect(roomFullBody.retryAfterMs).toBeUndefined();

    const perUserState = new FakeDurableObjectState() as unknown as DurableObjectState;
    const existing = new FakeWebSocket();
    existing.serializeAttachment({ user: alice } as unknown as { user: AuthUser });
    (perUserState as unknown as FakeDurableObjectState).acceptWebSocket(
      existing as unknown as WebSocket,
    );
    const perUserRoom = new ChatRoom(perUserState, {
      ...envBase,
      CHAT_MAX_CONNECTIONS_PER_USER: "1",
    });
    const tooMany = await perUserRoom.fetch(
      new Request("https://example.test/ws", {
        headers: { Upgrade: "websocket", Authorization: "Bearer token" },
      }),
    );
    expect(tooMany.status).toBe(429);
    const tooManyBody: WsHandshakeRejection = await tooMany.json();
    expect(tooManyBody.code).toBe("too_many_connections");
    expect(tooMany.headers.get("retry-after")).toBeNull();
    expect(tooManyBody.retryAfterMs).toBeUndefined();

    const rateLimitedState = new FakeDurableObjectState() as unknown as DurableObjectState;
    const rateLimitedRoom = new ChatRoom(rateLimitedState, {
      ...envBase,
      CHAT_CONNECT_RATE_WINDOW_MS: "1000",
      CHAT_CONNECT_RATE_MAX_COUNT: "1",
    });
    const rateLimitedReq = new Request("https://example.test/ws", {
      headers: {
        Upgrade: "websocket",
        Authorization: "Bearer token",
        "cf-connecting-ip": "5.6.7.8",
      },
    });
    await rateLimitedRoom.fetch(rateLimitedReq).catch(() => {});
    const rateLimited429 = await rateLimitedRoom.fetch(rateLimitedReq);
    expect(rateLimited429.status).toBe(429);
    const rateLimitedBody: WsHandshakeRejection = await rateLimited429.json();
    expect(rateLimitedBody.code).toBe("rate_limited");
    expect(typeof rateLimitedBody.retryAfterMs).toBe("number");
    expect(Number(rateLimited429.headers.get("retry-after"))).toBeGreaterThan(0);

    const codeSet = [roomFullBody.code, tooManyBody.code, rateLimitedBody.code].sort();
    expect(codeSet).toEqual(["rate_limited", "room_full", "too_many_connections"]);

    verifySessionTokenMock.mockReset();
  });
});
