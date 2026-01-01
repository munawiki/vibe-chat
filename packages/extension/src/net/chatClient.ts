import * as vscode from "vscode";
import WebSocket from "ws";
import { ClientEventSchema, PROTOCOL_VERSION, ServerEventSchema } from "@vscode-chat/protocol";
import type { ClientEvent, ServerEvent } from "@vscode-chat/protocol";
import type { ExtensionTelemetry } from "../telemetry.js";
import { getGitHubSession, onDidChangeGitHubSessions } from "../adapters/vscodeAuth.js";
import { autoConnectEnabled, getBackendUrl } from "../adapters/vscodeConfig.js";
import { exchangeSession } from "../adapters/sessionExchange.js";
import {
  cancelReconnectTimer,
  scheduleReconnectTimer,
  type ReconnectTimer,
} from "../adapters/reconnectTimer.js";
import { openWebSocket } from "../adapters/wsConnection.js";
import {
  initialChatClientCoreState,
  reduceChatClientCore,
  type ChatClientCoreCommand,
  type ChatClientCoreEvent,
  type ChatClientCoreState,
  type ChatClientState,
} from "../core/chatClientCore.js";

export type { AuthStatus, ChatClientState } from "../core/chatClientCore.js";

export class ChatClient implements vscode.Disposable {
  private ws: WebSocket | undefined;
  private reconnectTimer: ReconnectTimer | undefined;
  private readonly suppressedReconnect = new WeakSet<WebSocket>();

  private core: ChatClientCoreState;
  private state: ChatClientState;
  private readonly listeners = new Set<(state: ChatClientState) => void>();
  private readonly messageListeners = new Set<(event: ServerEvent) => void>();
  private readonly disposables: vscode.Disposable[] = [];
  private runChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly output: vscode.LogOutputChannel,
    private readonly telemetry?: ExtensionTelemetry,
  ) {
    this.core = initialChatClientCoreState();
    this.state = this.core.publicState;
  }

  dispose(): void {
    cancelReconnectTimer(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.closeSocket(1000, "dispose");
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  onState(listener: (state: ChatClientState) => void): vscode.Disposable {
    this.listeners.add(listener);
    listener(this.state);
    return { dispose: () => this.listeners.delete(listener) };
  }

  onEvent(listener: (event: ServerEvent) => void): vscode.Disposable {
    this.messageListeners.add(listener);
    return { dispose: () => this.messageListeners.delete(listener) };
  }

  getState(): ChatClientState {
    return this.state;
  }

  start(): void {
    this.disposables.push(
      onDidChangeGitHubSessions(() => {
        this.run({ type: "auth/refresh.requested" }).catch((err) => {
          this.output.warn(`auth refresh failed: ${String(err)}`);
        });
      }),
    );

    this.run({ type: "auth/refresh.requested" }).catch((err) => {
      this.output.warn(`initial auth refresh failed: ${String(err)}`);
    });
  }

  async refreshAuthState(): Promise<void> {
    await this.run({ type: "auth/refresh.requested" });
  }

  async signIn(): Promise<void> {
    await this.run({ type: "ui/signIn" });
    this.output.info("GitHub session acquired.");
  }

  async connect(): Promise<void> {
    await this.connectInteractive();
  }

  async connectInteractive(): Promise<void> {
    const backendUrl = getBackendUrl();
    await this.run({ type: "ui/connect", origin: "user", backendUrl, interactive: true });
  }

  async connectIfSignedIn(): Promise<boolean> {
    const backendUrl = getBackendUrl();
    await this.run({ type: "ui/connect", origin: "user", backendUrl, interactive: false });
    return this.state.status === "connected";
  }

  async signInAndConnect(): Promise<void> {
    await this.connectInteractive();
  }

  disconnect(): void {
    this.run({ type: "ui/disconnect" }).catch((err) => {
      this.output.warn(`disconnect failed: ${String(err)}`);
    });
  }

  sendMessage(text: string): void {
    const payload: ClientEvent = { version: PROTOCOL_VERSION, type: "client/message.send", text };
    const parsed = ClientEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.output.warn("Rejected client payload by schema.");
      return;
    }

    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.output.warn("WebSocket not open.");
      return;
    }

    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      this.output.warn(`WebSocket send failed: ${String(err)}`);
    }
  }

  private setState(next: ChatClientState): void {
    this.state = next;
    for (const listener of this.listeners) listener(this.state);
  }

  private run(event: ChatClientCoreEvent): Promise<void> {
    const job = async (): Promise<void> => {
      await this.process(event);
    };

    const next = this.runChain.then(job, job);
    this.runChain = next;
    return next;
  }

  private async process(event: ChatClientCoreEvent): Promise<void> {
    const { state: next, commands } = reduceChatClientCore(this.core, event);
    this.core = next;
    this.setState(this.core.publicState);

    for (const cmd of commands) {
      const followUp = await this.execute(cmd);
      if (followUp) await this.process(followUp);
    }
  }

  private async execute(cmd: ChatClientCoreCommand): Promise<ChatClientCoreEvent | void> {
    switch (cmd.type) {
      case "cmd/github.session.get": {
        try {
          const session = cmd.interactive
            ? await getGitHubSession({ interactive: true })
            : await getGitHubSession({ interactive: false });
          const nowMs = Date.now();
          return session
            ? { type: "github/session.result", ok: true, session, nowMs }
            : { type: "github/session.result", ok: false, nowMs };
        } catch (err) {
          return { type: "github/session.result", ok: false, nowMs: Date.now(), error: err };
        }
      }

      case "cmd/auth.exchange": {
        const result = await exchangeSession(cmd.backendUrl, cmd.accessToken);
        return result.ok
          ? { type: "auth/exchange.result", ok: true, session: result.session }
          : { type: "auth/exchange.result", ok: false, error: result.error };
      }

      case "cmd/ws.open": {
        this.closeSocket(1000, "reconnect");

        const wsUrl = cmd.backendUrl.replace(/^http/, "ws") + "/ws";
        const result = await openWebSocket({
          wsUrl,
          token: cmd.token,
          onClose: (ws, code, reason) => this.onWsClose(ws, code, reason),
          onMessage: (ws, text) => this.onWsMessage(ws, text),
          onError: (ws, err) => this.onWsError(ws, err),
        });

        if (!result.ok) {
          return { type: "ws/open.result", ok: false, error: result.error, cause: result.cause };
        }

        this.ws = result.ws;
        try {
          result.ws.send(
            JSON.stringify({
              version: PROTOCOL_VERSION,
              type: "client/hello",
              client: { name: "vscode", version: vscode.version },
            } satisfies ClientEvent),
          );
        } catch (err) {
          this.output.warn(`WebSocket hello failed: ${String(err)}`);
        }

        return { type: "ws/open.result", ok: true };
      }

      case "cmd/ws.close": {
        this.closeSocket(cmd.code, cmd.reason);
        return;
      }

      case "cmd/reconnect.cancel": {
        cancelReconnectTimer(this.reconnectTimer);
        this.reconnectTimer = undefined;
        return;
      }

      case "cmd/reconnect.schedule": {
        if (this.reconnectTimer) return;
        this.reconnectTimer = scheduleReconnectTimer(cmd.delayMs, () => this.onReconnectTimer());
        return;
      }

      case "cmd/telemetry.send": {
        this.telemetry?.send(cmd.event);
        return;
      }

      case "cmd/raise": {
        throw cmd.error;
      }
    }
  }

  private closeSocket(code: number, reason: string): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = undefined;
    this.suppressedReconnect.add(ws);
    try {
      ws.close(code, reason);
    } catch {
      // ignore
    }
  }

  private onWsError(ws: WebSocket, err: unknown): void {
    if (ws !== this.ws) return;
    this.output.error(`WebSocket error: ${String(err)}`);
  }

  private onWsClose(ws: WebSocket, code: number, reason: string): void {
    if (ws !== this.ws) return;
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

    for (const listener of this.messageListeners) listener(parsed.data);
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
}
