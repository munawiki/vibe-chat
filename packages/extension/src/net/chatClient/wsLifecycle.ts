import * as vscode from "vscode";
import WebSocket from "ws";
import { PROTOCOL_VERSION, ServerEventSchema } from "@vscode-chat/protocol";
import type { ClientEvent, ServerEvent } from "@vscode-chat/protocol";
import { autoConnectEnabled, getBackendUrl } from "../../adapters/vscodeConfig.js";
import {
  cancelReconnectTimer,
  scheduleReconnectTimer,
  type ReconnectTimer,
} from "../../adapters/reconnectTimer.js";
import { openWebSocket } from "../../adapters/wsConnection.js";
import { startWsHeartbeat, type WsHeartbeatHandle } from "../../adapters/wsHeartbeat.js";
import { WS_PING_INTERVAL_MS, WS_PONG_TIMEOUT_MS } from "../constants.js";
import type {
  ChatClientCoreEvent,
  ChatClientState,
  WsOpenError,
} from "../../core/chatClientCore.js";

export type WsSendResult =
  | { ok: true }
  | { ok: false; reason: "not_open" }
  | { ok: false; reason: "send_failed"; error: unknown };

export class ChatClientWsLifecycle {
  private ws: WebSocket | undefined;
  private wsHeartbeat: WsHeartbeatHandle | undefined;
  private reconnectTimer: ReconnectTimer | undefined;
  private readonly suppressedReconnect = new WeakSet<WebSocket>();

  constructor(
    private readonly output: vscode.LogOutputChannel,
    private readonly emitServerEvent: (event: ServerEvent) => void,
    private readonly run: (event: ChatClientCoreEvent) => Promise<void>,
    private readonly getState: () => ChatClientState,
  ) {}

  dispose(): void {
    this.cancelReconnect();
    this.stopWsHeartbeat();
    this.closeSocket(1000, "dispose");
  }

  sendClientEvent(payload: ClientEvent): WsSendResult {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { ok: false, reason: "not_open" };
    }

    try {
      ws.send(JSON.stringify(payload));
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: "send_failed", error };
    }
  }

  cancelReconnect(): void {
    cancelReconnectTimer(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = scheduleReconnectTimer(delayMs, () => this.onReconnectTimer());
  }

  closeSocket(code: number, reason: string): void {
    this.stopWsHeartbeat();
    const ws = this.ws;
    if (!ws) return;
    this.ws = undefined;
    this.suppressedReconnect.add(ws);
    try {
      ws.close(code, reason);
    } catch {}
  }

  emitLegacyFallbackDiagnostic(event: {
    fallback: "handshake_429_body";
    kind: "rate_limited" | "room_full" | "too_many_connections" | "unknown";
  }): void {
    this.output.info(
      `ws fallback diagnostic: ${JSON.stringify({
        boundary: "ws.handshake.fallback",
        phase: "classify_429",
        outcome: "legacy_fallback",
        fallback: event.fallback,
        kind: event.kind,
      })}`,
    );
  }

  async openConnection(options: {
    backendUrl: string;
    token: string;
  }): Promise<ChatClientCoreEvent> {
    this.closeSocket(1000, "reconnect");

    const result = await openWebSocket({
      wsUrl: this.buildWsUrl(options.backendUrl),
      token: options.token,
      ...this.createWsOpenCallbacks(),
    });

    if (!result.ok) {
      this.logHandshakeError(result.error);
      return { type: "ws/open.result", ok: false, error: result.error, cause: result.cause };
    }

    this.attachOpenedSocket(result.ws);
    return { type: "ws/open.result", ok: true };
  }

  private buildWsUrl(backendUrl: string): string {
    return backendUrl.replace(/^http/, "ws") + "/ws";
  }

  private createWsOpenCallbacks(): {
    onClose: (ws: WebSocket, code: number, reason: string) => void;
    onMessage: (ws: WebSocket, text: string) => void;
    onError: (ws: WebSocket, err: unknown) => void;
  } {
    return {
      onClose: (ws, code, reason) => this.onWsClose(ws, code, reason),
      onMessage: (ws, text) => this.onWsMessage(ws, text),
      onError: (ws, err) => this.onWsError(ws, err),
    };
  }

  private attachOpenedSocket(ws: WebSocket): void {
    this.ws = ws;
    this.wsHeartbeat = startWsHeartbeat({
      ws,
      pingIntervalMs: WS_PING_INTERVAL_MS,
      pongTimeoutMs: WS_PONG_TIMEOUT_MS,
      onTimeout: ({ elapsedSinceLastPongMs }) => {
        this.output.warn(
          `WebSocket heartbeat timeout (no pong for ${elapsedSinceLastPongMs}ms). Terminating.`,
        );
      },
    });

    this.trySendWsHello(ws);
  }

  private logHandshakeError(error: WsOpenError): void {
    if (error.type !== "handshake_http_error") return;
    const parts = [`HTTP ${error.status}`];
    if (typeof error.retryAfterMs === "number") parts.push(`retryAfterMs=${error.retryAfterMs}`);
    const preview = error.bodyText?.trim();
    if (preview) parts.push(`body="${preview.replaceAll(/\s+/g, " ").slice(0, 200)}"`);
    this.output.warn(`WebSocket handshake failed: ${parts.join(" ")}`);
  }

  private trySendWsHello(ws: WebSocket): void {
    try {
      ws.send(
        JSON.stringify({
          version: PROTOCOL_VERSION,
          type: "client/hello",
          client: { name: "vscode", version: vscode.version },
        } satisfies ClientEvent),
      );
    } catch (err) {
      this.output.warn(`WebSocket hello failed: ${String(err)}`);
    }
  }

  private onWsError(ws: WebSocket, err: unknown): void {
    if (ws !== this.ws) return;
    this.output.error(`WebSocket error: ${String(err)}`);
  }

  private onWsClose(ws: WebSocket, code: number, reason: string): void {
    if (ws !== this.ws) return;
    this.stopWsHeartbeat();
    this.ws = undefined;

    const suppressed = this.suppressedReconnect.has(ws);
    if (suppressed) this.suppressedReconnect.delete(ws);

    this.output.warn(`WebSocket closed: ${code} ${reason}`);

    this.run({
      type: "ws/closed",
      autoReconnectEnabled: autoConnectEnabled() && !suppressed,
    }).catch((err) => {
      this.output.warn(`ws/closed handler failed: ${String(err)}`);
    });
  }

  private onWsMessage(ws: WebSocket, data: string): void {
    if (ws !== this.ws) return;

    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      this.output.warn("Invalid JSON from server.");
      return;
    }

    const parsed = ServerEventSchema.safeParse(json);
    if (!parsed.success) {
      this.output.warn("Invalid server event schema.");
      return;
    }

    if (parsed.data.type === "server/welcome") {
      this.run({ type: "ws/welcome", user: parsed.data.user }).catch((err) => {
        this.output.warn(`ws/welcome handler failed: ${String(err)}`);
      });
    }

    this.emitServerEvent(parsed.data);
  }

  private onReconnectTimer(): void {
    this.reconnectTimer = undefined;

    let backendUrl: string;
    try {
      backendUrl = getBackendUrl();
    } catch (err) {
      this.output.warn(`Reconnect skipped: ${String(err)}`);
      return;
    }

    this.run({ type: "timer/reconnect.fired", backendUrl })
      .then(async () => {
        const state = this.getState();
        if (state.authStatus !== "signedIn" || state.status === "connected") return;
        if (!autoConnectEnabled()) return;
        await this.run({ type: "ws/closed", autoReconnectEnabled: true });
      })
      .catch((err) => {
        this.output.warn(`Reconnect failed: ${String(err)}`);
      });
  }

  private stopWsHeartbeat(): void {
    this.wsHeartbeat?.stop();
    this.wsHeartbeat = undefined;
  }
}
