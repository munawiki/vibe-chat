import WebSocket from "ws";
import type { WsOpenError } from "../core/chatClientCore.js";

export type WsOpenResult =
  | { ok: true; ws: WebSocket }
  | { ok: false; error: WsOpenError; cause?: unknown };

export function openWebSocket(options: {
  wsUrl: string;
  token: string;
  onClose: (ws: WebSocket, code: number, reason: string) => void;
  onMessage: (ws: WebSocket, text: string) => void;
  onError: (ws: WebSocket, err: unknown) => void;
}): Promise<WsOpenResult> {
  const ws = new WebSocket(options.wsUrl, {
    headers: { Authorization: `Bearer ${options.token}` },
  });

  ws.on("close", (code, reason) => options.onClose(ws, code, reason.toString()));
  ws.on("message", (data) => {
    const text = rawDataToUtf8(data);
    options.onMessage(ws, text);
  });
  ws.on("error", (err) => options.onError(ws, err));

  return new Promise<WsOpenResult>((resolve) => {
    let settled = false;
    const settle = (result: WsOpenResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    ws.on("open", () => settle({ ok: true, ws }));

    ws.on("unexpected-response", (_request, response) => {
      const status = response.statusCode ?? 0;
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      settle({
        ok: false,
        error: { type: "handshake_http_error", status },
        cause: new Error(`ws_handshake_${status}`),
      });
    });

    ws.on("error", (err) => {
      settle({ ok: false, error: { type: "network_error" }, cause: err });
    });
  });
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
