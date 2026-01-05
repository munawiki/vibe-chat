import type WebSocket from "ws";

export type WsHeartbeatHandle = Readonly<{
  stop: () => void;
}>;

export type StartWsHeartbeatOptions = Readonly<{
  ws: WebSocket;
  pingIntervalMs: number;
  pongTimeoutMs: number;
  onTimeout?: (reason: { elapsedSinceLastPongMs: number }) => void;
  nowMs?: () => number;
}>;

export function startWsHeartbeat(options: StartWsHeartbeatOptions): WsHeartbeatHandle {
  if (options.pingIntervalMs <= 0) throw new Error("pingIntervalMs must be positive");
  if (options.pongTimeoutMs <= 0) throw new Error("pongTimeoutMs must be positive");
  if (options.pingIntervalMs > options.pongTimeoutMs) {
    throw new Error("pingIntervalMs must be <= pongTimeoutMs");
  }

  const ws = options.ws;
  const nowMs = options.nowMs ?? (() => Date.now());

  let lastPongAtMs = nowMs();
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    ws.off("pong", onPong);
    ws.off("close", onClose);
  };

  const onPong = () => {
    lastPongAtMs = nowMs();
  };

  const onClose = () => {
    stop();
  };

  const interval = setInterval(() => {
    const elapsed = nowMs() - lastPongAtMs;
    if (elapsed > options.pongTimeoutMs) {
      options.onTimeout?.({ elapsedSinceLastPongMs: elapsed });
      stop();
      try {
        ws.terminate();
      } catch {
        // ignore
      }
      return;
    }

    try {
      ws.ping();
    } catch {
      stop();
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    }
  }, options.pingIntervalMs);

  ws.on("pong", onPong);
  ws.on("close", onClose);

  return { stop };
}
