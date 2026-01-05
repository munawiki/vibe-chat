import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
import { startWsHeartbeat } from "../src/adapters/wsHeartbeat.js";

class MockWs extends EventEmitter {
  ping = vi.fn();
  terminate = vi.fn();
}

describe("wsHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings periodically until stopped", () => {
    const ws = new MockWs();
    const heartbeat = startWsHeartbeat({
      ws: ws as unknown as WebSocket,
      pingIntervalMs: 10,
      pongTimeoutMs: 50,
    });

    vi.advanceTimersByTime(35);
    expect(ws.ping).toHaveBeenCalledTimes(3);

    heartbeat.stop();
    vi.advanceTimersByTime(100);
    expect(ws.ping).toHaveBeenCalledTimes(3);
  });

  it("terminates when no pong is received within the timeout", () => {
    const ws = new MockWs();
    const onTimeout = vi.fn<(reason: { elapsedSinceLastPongMs: number }) => void>();

    startWsHeartbeat({
      ws: ws as unknown as WebSocket,
      pingIntervalMs: 20,
      pongTimeoutMs: 50,
      onTimeout,
    });

    vi.advanceTimersByTime(60);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith({ elapsedSinceLastPongMs: 60 });
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });

  it("resets the timeout when pong is received", () => {
    const ws = new MockWs();
    const onTimeout = vi.fn<(reason: { elapsedSinceLastPongMs: number }) => void>();

    const heartbeat = startWsHeartbeat({
      ws: ws as unknown as WebSocket,
      pingIntervalMs: 20,
      pongTimeoutMs: 50,
      onTimeout,
    });

    vi.advanceTimersByTime(40);
    ws.emit("pong");

    vi.advanceTimersByTime(40);
    ws.emit("pong");

    vi.advanceTimersByTime(40);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(ws.terminate).not.toHaveBeenCalled();

    heartbeat.stop();
  });
});
