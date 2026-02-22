import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const wsMock = vi.hoisted(() => ({
  lastInstance: undefined as undefined | { emit: (event: string, ...args: unknown[]) => void },
}));

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");

  class MockWebSocket extends EventEmitter {
    constructor(
      public readonly url: string,
      public readonly options: unknown,
    ) {
      super();
      wsMock.lastInstance = this;
    }

    terminate(): void {
      // no-op
    }
  }

  return { default: MockWebSocket };
});

import { openWebSocket } from "../src/adapters/wsConnection.js";

type WsOpenResult = Awaited<ReturnType<typeof openWebSocket>>;
type HandshakeHttpError = Extract<
  Extract<WsOpenResult, { ok: false }>["error"],
  { type: "handshake_http_error" }
>;

async function openWithUnexpectedResponse(options: {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}): Promise<WsOpenResult> {
  const promise = openWebSocket({
    wsUrl: "ws://example.test/ws",
    token: "t",
    onClose: () => {},
    onMessage: () => {},
    onError: () => {},
  });

  const ws = wsMock.lastInstance;
  expect(ws).toBeDefined();

  const response = new PassThrough() as PassThrough & {
    statusCode?: number;
    headers: Record<string, string | string[] | undefined>;
  };
  response.statusCode = options.statusCode;
  response.headers = options.headers;

  ws?.emit("unexpected-response", {}, response);
  response.end(options.body);

  return await promise;
}

function expectHandshakeHttpError(result: WsOpenResult): HandshakeHttpError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected error");

  expect(result.error.type).toBe("handshake_http_error");
  if (result.error.type !== "handshake_http_error") {
    throw new Error(`expected handshake_http_error, got ${result.error.type}`);
  }

  return result.error;
}

describe("wsConnection", () => {
  it("wires post-open listeners and decodes raw message payload variants", async () => {
    const onClose = vi.fn();
    const onMessage = vi.fn();
    const onError = vi.fn();

    const promise = openWebSocket({
      wsUrl: "ws://example.test/ws",
      token: "t",
      onClose,
      onMessage,
      onError,
    });

    const ws = wsMock.lastInstance;
    expect(ws).toBeDefined();
    ws?.emit("open");

    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected open result");

    ws?.emit("message", Buffer.from("hello"));
    ws?.emit("message", [Buffer.from("a"), Buffer.from("b")]);
    ws?.emit("message", Uint8Array.from([99]).buffer);
    ws?.emit("close", 1000, Buffer.from("done"));

    const wsError = new Error("socket_error");
    ws?.emit("error", wsError);

    expect(onMessage).toHaveBeenNthCalledWith(1, result.ws, "hello");
    expect(onMessage).toHaveBeenNthCalledWith(2, result.ws, "ab");
    expect(onMessage).toHaveBeenNthCalledWith(3, result.ws, "c");
    expect(onClose).toHaveBeenCalledWith(result.ws, 1000, "done");
    expect(onError).toHaveBeenCalledWith(result.ws, wsError);
  });

  it("returns network_error when websocket emits error before open", async () => {
    const promise = openWebSocket({
      wsUrl: "ws://example.test/ws",
      token: "t",
      onClose: () => {},
      onMessage: () => {},
      onError: () => {},
    });

    const ws = wsMock.lastInstance;
    expect(ws).toBeDefined();
    ws?.emit("error", new Error("dial_failed"));

    const result = await promise;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected network error");
    expect(result.error).toEqual({ type: "network_error" });
  });

  it("parses structured 429 handshake rejection bodies", async () => {
    const result = await openWithUnexpectedResponse({
      statusCode: 429,
      headers: {},
      body: JSON.stringify({ code: "too_many_connections", message: "Too many connections" }),
    });

    const error = expectHandshakeHttpError(result);
    expect(error.status).toBe(429);
    expect(error.handshakeRejection?.code).toBe("too_many_connections");
  });

  it("prefers Retry-After header over body retryAfterMs", async () => {
    const result = await openWithUnexpectedResponse({
      statusCode: 429,
      headers: { "retry-after": "10" },
      body: JSON.stringify({
        code: "rate_limited",
        message: "Too many connection attempts",
        retryAfterMs: 1_000,
      }),
    });

    const error = expectHandshakeHttpError(result);
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(10_000);
    expect(error.handshakeRejection?.code).toBe("rate_limited");
  });

  it("parses Retry-After HTTP-date headers", async () => {
    const retryAt = new Date(Date.now() + 30_000).toUTCString();
    const result = await openWithUnexpectedResponse({
      statusCode: 429,
      headers: { "retry-after": retryAt },
      body: JSON.stringify({
        code: "rate_limited",
        message: "Too many connection attempts",
      }),
    });

    const error = expectHandshakeHttpError(result);
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBeGreaterThanOrEqual(0);
    expect(error.retryAfterMs).toBeLessThanOrEqual(30_000);
  });

  it("keeps legacy body text when the response is not JSON", async () => {
    const result = await openWithUnexpectedResponse({
      statusCode: 429,
      headers: {},
      body: "Room is full",
    });

    const error = expectHandshakeHttpError(result);
    expect(error.status).toBe(429);
    expect(error.handshakeRejection).toBeUndefined();
    expect(error.bodyText).toBe("Room is full");
  });

  it("bounds oversized handshake rejection bodies", async () => {
    const body = "x".repeat(10_000);
    const result = await openWithUnexpectedResponse({
      statusCode: 429,
      headers: {},
      body,
    });

    const error = expectHandshakeHttpError(result);
    expect(error.bodyText).toBe(body.slice(0, 1024));
  });

  it("bounds handshake rejection body reads by timeout", async () => {
    vi.useFakeTimers();
    try {
      const promise = openWebSocket({
        wsUrl: "ws://example.test/ws",
        token: "t",
        onClose: () => {},
        onMessage: () => {},
        onError: () => {},
      });

      const ws = wsMock.lastInstance;
      expect(ws).toBeDefined();

      const response = new PassThrough() as PassThrough & {
        statusCode?: number;
        headers: Record<string, string | string[] | undefined>;
      };
      response.statusCode = 503;
      response.headers = {};

      ws?.emit("unexpected-response", {}, response);

      await vi.advanceTimersByTimeAsync(1_100);
      const result = await promise;
      const error = expectHandshakeHttpError(result);
      expect(error.status).toBe(503);
      expect(error.bodyText).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles handshake error when response body stream errors", async () => {
    const promise = openWebSocket({
      wsUrl: "ws://example.test/ws",
      token: "t",
      onClose: () => {},
      onMessage: () => {},
      onError: () => {},
    });

    const ws = wsMock.lastInstance;
    expect(ws).toBeDefined();

    const response = new PassThrough() as PassThrough & {
      statusCode?: number;
      headers: Record<string, string | string[] | undefined>;
    };
    response.statusCode = 502;
    response.headers = {};

    ws?.emit("unexpected-response", {}, response);
    response.emit("error", new Error("read_failed"));

    const result = await promise;
    const error = expectHandshakeHttpError(result);
    expect(error.status).toBe(502);
    expect(error.bodyText).toBeUndefined();
  });

  it("parses string chunks from handshake response streams", async () => {
    const promise = openWebSocket({
      wsUrl: "ws://example.test/ws",
      token: "t",
      onClose: () => {},
      onMessage: () => {},
      onError: () => {},
    });

    const ws = wsMock.lastInstance;
    expect(ws).toBeDefined();

    const response = new PassThrough() as PassThrough & {
      statusCode?: number;
      headers: Record<string, string | string[] | undefined>;
    };
    response.statusCode = 429;
    response.headers = {};
    response.setEncoding("utf8");

    ws?.emit("unexpected-response", {}, response);
    response.write("Room");
    response.end(" is full");

    const result = await promise;
    const error = expectHandshakeHttpError(result);
    expect(error.bodyText).toBe("Room is full");
  });
});
