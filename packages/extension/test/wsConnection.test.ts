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
});
