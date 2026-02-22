import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "@vscode-chat/protocol";
import type { GithubUserId, ServerEvent } from "@vscode-chat/protocol";

vi.mock("../src/session.js", () => ({
  verifySessionToken: () =>
    Promise.resolve({
      githubUserId: "1" as GithubUserId,
      login: "alice",
      avatarUrl: "https://example.test/alice.png",
    }),
}));

import { ChatRoom } from "../src/room/chatRoom.js";

type StoredAttachment = {
  user: { githubUserId: GithubUserId; login: string; avatarUrl: string; roles: string[] };
};

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

describe("ChatRoom", () => {
  it("accepts websocket connections, sends welcome, and handles messages", async () => {
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
        MODERATOR_GITHUB_USER_IDS: "1",
      } as unknown as ConstructorParameters<typeof ChatRoom>[1];

      const room = new ChatRoom(state, env);

      // Node's `Response` implementation rejects 101 Switching Protocols.
      // The room should still have accepted the socket and sent initial events before that point.
      await room
        .fetch(
          new Request("https://example.test/ws", {
            headers: { Upgrade: "websocket", Authorization: "Bearer test-token" },
          }),
        )
        .catch((err: unknown) => {
          expect(err).toBeInstanceOf(RangeError);
        });

      const sockets = (state as unknown as FakeDurableObjectState).getWebSockets();
      expect(sockets.length).toBe(1);
      const firstSocket = sockets[0];
      if (!firstSocket) throw new Error("missing socket");
      const serverWs = firstSocket as unknown as FakeWebSocket;

      const attachment = serverWs.deserializeAttachment() as StoredAttachment | undefined;
      expect(attachment?.user.login).toBe("alice");

      expect(serverWs.sent.some((s) => s.includes('"type":"server/welcome"'))).toBe(true);
      expect(serverWs.sent.some((s) => s.includes('"type":"server/moderation.snapshot"'))).toBe(
        true,
      );

      vi.advanceTimersByTime(200);
      expect(serverWs.sent.some((s) => s.includes('"type":"server/presence"'))).toBe(true);

      await room.webSocketMessage(
        firstSocket,
        JSON.stringify({
          version: PROTOCOL_VERSION,
          type: "client/message.send",
          text: "hi",
          clientMessageId: "11111111-1111-1111-1111-111111111111",
        }),
      );

      expect(serverWs.sent.some((s) => s.includes('"type":"server/message.new"'))).toBe(true);

      const oversized = "x".repeat(20_000);
      const tooBigWs = new FakeWebSocket() as unknown as WebSocket;
      await room.webSocketMessage(tooBigWs, oversized);
      expect((tooBigWs as unknown as FakeWebSocket).closed[0]?.code).toBe(1009);

      const invalidWs = new FakeWebSocket() as unknown as WebSocket;
      await room.webSocketMessage(invalidWs, "{");
      await room.webSocketMessage(invalidWs, "{");
      await room.webSocketMessage(invalidWs, "{");
      expect((invalidWs as unknown as FakeWebSocket).closed.at(-1)?.code).toBe(1008);
    } finally {
      (globalThis as unknown as GlobalWithWebSocketPair).WebSocketPair = prevPair;
      vi.useRealTimers();
    }
  });

  it("keeps chat message rate-limit error semantics stable with and without clientMessageId", async () => {
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
      CHAT_MESSAGE_RATE_WINDOW_MS: "1000",
      CHAT_MESSAGE_RATE_MAX_COUNT: "2",
    } as unknown as ConstructorParameters<typeof ChatRoom>[1];

    const room = new ChatRoom(state, env);

    const ws = new FakeWebSocket();
    ws.serializeAttachment({
      user: {
        githubUserId: "1" as GithubUserId,
        login: "alice",
        avatarUrl: "https://example.test/alice.png",
        roles: [],
      },
    } satisfies StoredAttachment);
    (state as unknown as FakeDurableObjectState).acceptWebSocket(ws as unknown as WebSocket);

    await room.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/message.send",
        text: "one",
        clientMessageId: "11111111-1111-1111-1111-111111111111",
      }),
    );
    await room.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/message.send",
        text: "two",
      }),
    );
    await room.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/message.send",
        text: "three",
        clientMessageId: "33333333-3333-3333-3333-333333333333",
      }),
    );
    await room.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "client/message.send",
        text: "four",
      }),
    );

    const events = parseSent(ws);
    const messageNews = events.filter((e) => e.type === "server/message.new");
    expect(messageNews).toHaveLength(2);

    const errors = events.filter(
      (e): e is Extract<ServerEvent, { type: "server/error" }> => e.type === "server/error",
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]?.code).toBe("rate_limited");
    expect(errors[0]?.clientMessageId).toBe("33333333-3333-3333-3333-333333333333");
    expect(errors[1]?.code).toBe("rate_limited");
    expect(errors[1]?.clientMessageId).toBeUndefined();
  });
});
