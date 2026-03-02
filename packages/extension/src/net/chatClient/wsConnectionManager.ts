import type { ClientEvent } from "@vscode-chat/protocol";
import type { ChatClientCoreEvent } from "../../core/chatClientCore.js";
import { ChatClientWsLifecycle, type WsSendResult } from "./wsLifecycle.js";

export class WsConnectionManager {
  constructor(private readonly lifecycle: ChatClientWsLifecycle) {}

  dispose(): void {
    this.lifecycle.dispose();
  }

  sendClientEvent(payload: ClientEvent): WsSendResult {
    return this.lifecycle.sendClientEvent(payload);
  }

  cancelReconnect(): void {
    this.lifecycle.cancelReconnect();
  }

  scheduleReconnect(delayMs: number): void {
    this.lifecycle.scheduleReconnect(delayMs);
  }

  closeSocket(code: number, reason: string): void {
    this.lifecycle.closeSocket(code, reason);
  }

  emitLegacyFallbackDiagnostic(event: {
    fallback: "handshake_429_body";
    kind: "rate_limited" | "room_full" | "too_many_connections" | "unknown";
  }): void {
    this.lifecycle.emitLegacyFallbackDiagnostic(event);
  }

  openConnection(options: { backendUrl: string; token: string }): Promise<ChatClientCoreEvent> {
    return this.lifecycle.openConnection(options);
  }
}
