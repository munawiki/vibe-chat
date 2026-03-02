import { Readable } from "node:stream";
import {
  readBoundedBody,
  WsHandshakeRejectionSchema,
  type WsHandshakeRejection,
} from "@vscode-chat/protocol";
import WebSocket from "ws";
import { WS_HANDSHAKE_BODY_TIMEOUT_MS, WS_HANDSHAKE_MAX_BODY_BYTES } from "../net/constants.js";
import type { WsOpenError } from "../core/chatClientCore.js";

export type WsOpenResult =
  | { ok: true; ws: WebSocket }
  | { ok: false; error: WsOpenError; cause?: unknown };

export async function openWebSocket(options: {
  wsUrl: string;
  token: string;
  onClose: (ws: WebSocket, code: number, reason: string) => void;
  onMessage: (ws: WebSocket, text: string) => void;
  onError: (ws: WebSocket, err: unknown) => void;
}): Promise<WsOpenResult> {
  const ws = new WebSocket(options.wsUrl, {
    headers: { Authorization: `Bearer ${options.token}` },
  });

  const openResult = await waitForWsOpenOrHandshakeError(ws);
  if (openResult.ok) {
    // Post-open handlers: these must not influence the "handshake" result.
    ws.on("close", (code, reason) => options.onClose(ws, code, reason.toString()));
    ws.on("message", (data) => {
      const text = rawDataToUtf8(data);
      options.onMessage(ws, text);
    });
    ws.on("error", (err) => options.onError(ws, err));
  }

  return openResult;
}

function waitForWsOpenOrHandshakeError(ws: WebSocket): Promise<WsOpenResult> {
  return new Promise<WsOpenResult>((resolve) => {
    let settled = false;

    const settle = (result: WsOpenResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onOpen = () => settle({ ok: true, ws });

    const onHandshakeError = (
      _request: unknown,
      response: NodeJS.ReadableStream & {
        statusCode?: number;
        headers: Record<string, string | string[] | undefined>;
      },
    ) => {
      // If a structured handshake rejection arrives, prefer it over any subsequent ws "error" event.
      ws.off("open", onOpen);
      ws.off("error", onError);
      ws.off("unexpected-response", onHandshakeError);

      const status = response.statusCode ?? 0;
      const headerRetryAfterMs = parseRetryAfterMs(response.headers["retry-after"]);

      const cleanupAndSettle = (bodyText?: string) => {
        try {
          ws.terminate();
        } catch {}

        const handshakeRejection =
          typeof bodyText === "string" ? parseWsHandshakeRejection(bodyText) : undefined;
        const retryAfterMs =
          typeof headerRetryAfterMs === "number"
            ? headerRetryAfterMs
            : handshakeRejection?.retryAfterMs;

        const error: WsOpenError = {
          type: "handshake_http_error",
          status,
          ...(typeof retryAfterMs === "number" ? { retryAfterMs } : {}),
          ...(typeof bodyText === "string" ? { bodyText } : {}),
          ...(handshakeRejection ? { handshakeRejection } : {}),
        };
        settle({ ok: false, error, cause: new Error(`ws_handshake_${status}`) });
      };

      void readResponseBodyText(response, {
        maxBytes: WS_HANDSHAKE_MAX_BODY_BYTES,
        timeoutMs: WS_HANDSHAKE_BODY_TIMEOUT_MS,
      })
        .then((bodyText) => cleanupAndSettle(bodyText))
        .catch(() => cleanupAndSettle());
    };

    const onError = (err: unknown) => {
      settle({ ok: false, error: { type: "network_error" }, cause: err });
    };

    const cleanup = () => {
      ws.off("open", onOpen);
      ws.off("unexpected-response", onHandshakeError);
      ws.off("error", onError);
    };

    ws.on("open", onOpen);
    ws.on("unexpected-response", onHandshakeError);
    ws.on("error", onError);
  });
}

function parseWsHandshakeRejection(bodyText: string): WsHandshakeRejection | undefined {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return undefined;
  }

  try {
    const parsed = WsHandshakeRejectionSchema.safeParse(json);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function rawDataToUtf8(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");

  // NOTE: ws@8 raw data is a discriminated union. This is kept as a safeguard
  // in case future versions widen the type.
  const unreachable: never = data;
  throw new Error(`Unexpected ws message payload: ${String(unreachable)}`);
}

function parseRetryAfterMs(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;

  // RFC 9110: Retry-After can be delta-seconds or HTTP-date.
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return undefined;

  const deltaMs = dateMs - Date.now();
  return Math.max(deltaMs, 0);
}

function readResponseBodyText(
  response: NodeJS.ReadableStream,
  options: { maxBytes: number; timeoutMs: number },
): Promise<string> {
  const toUtf8 = (chunks: Buffer[]): string => {
    if (chunks.length === 0) return "";
    return Buffer.concat(chunks).subarray(0, options.maxBytes).toString("utf8").trim();
  };

  return readBoundedBody({
    source: responseBodyChunks(response),
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
    chunkByteLength: (chunk) => chunk.byteLength,
  }).then((result) => {
    if (result.ok) return toUtf8(result.chunks);
    if (result.error === "timeout" || result.error === "too_large") {
      return toUtf8(result.chunks);
    }
    throw new Error("read_error");
  });
}

function asNodeReadable(response: NodeJS.ReadableStream): Readable {
  if (response instanceof Readable) return response;
  const wrapped = new Readable({ read() {} });
  wrapped.wrap(response);
  return wrapped;
}

function responseBodyChunks(response: NodeJS.ReadableStream): AsyncIterable<Buffer> {
  const readable = asNodeReadable(response);
  return {
    [Symbol.asyncIterator](): AsyncIterator<Buffer> {
      const iterator = readable[Symbol.asyncIterator]();
      return {
        async next(): Promise<IteratorResult<Buffer>> {
          while (true) {
            const next = await iterator.next();
            if (next.done) return { done: true, value: undefined };
            if (typeof next.value === "string") {
              return { done: false, value: Buffer.from(next.value, "utf8") };
            }
            if (Buffer.isBuffer(next.value)) {
              return { done: false, value: next.value };
            }
            if (next.value instanceof Uint8Array) {
              return { done: false, value: Buffer.from(next.value) };
            }
          }
        },
        async return(): Promise<IteratorResult<Buffer>> {
          if (!readable.destroyed) readable.destroy();
          await iterator.return?.();
          return { done: true, value: undefined };
        },
      };
    },
  };
}
