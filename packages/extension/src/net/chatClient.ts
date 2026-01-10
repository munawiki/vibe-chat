import * as vscode from "vscode";
import WebSocket from "ws";
import { ClientEventSchema, PROTOCOL_VERSION, ServerEventSchema } from "@vscode-chat/protocol";
import type {
  ClientEvent,
  DmId,
  DmIdentity,
  GithubUserId,
  ServerEvent,
} from "@vscode-chat/protocol";
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
import { startWsHeartbeat, type WsHeartbeatHandle } from "../adapters/wsHeartbeat.js";
import {
  initialChatClientCoreState,
  reduceChatClientCore,
  type ChatClientCoreCommand,
  type ChatClientCoreEvent,
  type ChatClientCoreState,
  type ChatClientState,
} from "../core/chatClientCore.js";
import type { ExtensionBus } from "../bus/extensionBus.js";

export type { AuthStatus, ChatClientState } from "../core/chatClientCore.js";

const WS_PING_INTERVAL_MS = 20_000;
const WS_PONG_TIMEOUT_MS = 60_000;
const AUTH_SUPPRESSED_BY_USER_KEY = "vscodeChat.auth.suppressedByUser.v1";
const CLEAR_SESSION_PREFERENCE_ON_NEXT_SIGN_IN_KEY =
  "vscodeChat.auth.clearSessionPreferenceOnNextSignIn.v1";

export class ChatClient implements vscode.Disposable {
  private ws: WebSocket | undefined;
  private wsHeartbeat: WsHeartbeatHandle | undefined;
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
    private readonly globalState: vscode.Memento,
    private readonly bus: ExtensionBus,
    private readonly telemetry?: ExtensionTelemetry,
  ) {
    this.core = initialChatClientCoreState({
      authSuppressedByUser: this.globalState.get<boolean>(AUTH_SUPPRESSED_BY_USER_KEY) ?? false,
      clearSessionPreferenceOnNextSignIn:
        this.globalState.get<boolean>(CLEAR_SESSION_PREFERENCE_ON_NEXT_SIGN_IN_KEY) ?? false,
    });
    this.state = this.core.publicState;
  }

  dispose(): void {
    cancelReconnectTimer(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.stopWsHeartbeat();
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

  async signOut(): Promise<void> {
    await this.run({ type: "ui/signOut" });
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

  sendMessage(options: { text: string; clientMessageId?: string }): void {
    const payload: ClientEvent = {
      version: PROTOCOL_VERSION,
      type: "client/message.send",
      text: options.text,
      ...(options.clientMessageId ? { clientMessageId: options.clientMessageId } : {}),
    };
    this.sendEvent(payload);
  }

  sendModerationDeny(targetGithubUserId: GithubUserId, reason?: string): void {
    const payload: ClientEvent = {
      version: PROTOCOL_VERSION,
      type: "client/moderation.user.deny",
      targetGithubUserId,
      ...(typeof reason === "string" && reason.trim().length > 0 ? { reason } : {}),
    };
    this.sendEvent(payload);
  }

  sendModerationAllow(targetGithubUserId: GithubUserId): void {
    const payload: ClientEvent = {
      version: PROTOCOL_VERSION,
      type: "client/moderation.user.allow",
      targetGithubUserId,
    };
    this.sendEvent(payload);
  }

  publishDmIdentity(identity: DmIdentity): void {
    const payload: ClientEvent = {
      version: PROTOCOL_VERSION,
      type: "client/dm.identity.publish",
      identity,
    };
    this.sendEvent(payload);
  }

  openDm(targetGithubUserId: GithubUserId): void {
    const payload: ClientEvent = {
      version: PROTOCOL_VERSION,
      type: "client/dm.open",
      targetGithubUserId,
    };
    this.sendEvent(payload);
  }

  sendDmMessage(options: {
    dmId: DmId;
    recipientGithubUserId: GithubUserId;
    senderIdentity: DmIdentity;
    recipientIdentity: DmIdentity;
    nonce: string;
    ciphertext: string;
  }): void {
    const payload: ClientEvent = {
      version: PROTOCOL_VERSION,
      type: "client/dm.message.send",
      dmId: options.dmId,
      recipientGithubUserId: options.recipientGithubUserId,
      senderIdentity: options.senderIdentity,
      recipientIdentity: options.recipientIdentity,
      nonce: options.nonce,
      ciphertext: options.ciphertext,
    };
    this.sendEvent(payload);
  }

  private sendEvent(payload: ClientEvent): void {
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
    const prev = this.core;
    const { state: next, commands } = reduceChatClientCore(this.core, event);
    this.core = next;
    this.setState(this.core.publicState);
    await this.syncPersistentState(prev, next);
    this.emitBusEvents(prev, next);

    for (const cmd of commands) {
      const followUp = await this.execute(cmd);
      if (followUp) await this.process(followUp);
    }
  }

  private async syncPersistentState(
    prev: ChatClientCoreState,
    next: ChatClientCoreState,
  ): Promise<void> {
    const updates: Promise<void>[] = [];

    if (prev.authSuppressedByUser !== next.authSuppressedByUser) {
      updates.push(
        Promise.resolve(
          this.globalState.update(AUTH_SUPPRESSED_BY_USER_KEY, next.authSuppressedByUser),
        ),
      );
    }
    if (prev.clearSessionPreferenceOnNextSignIn !== next.clearSessionPreferenceOnNextSignIn) {
      updates.push(
        Promise.resolve(
          this.globalState.update(
            CLEAR_SESSION_PREFERENCE_ON_NEXT_SIGN_IN_KEY,
            next.clearSessionPreferenceOnNextSignIn,
          ),
        ),
      );
    }

    try {
      await Promise.all(updates);
    } catch (err) {
      this.output.warn(`Failed to persist auth state: ${String(err)}`);
    }
  }

  private emitBusEvents(prev: ChatClientCoreState, next: ChatClientCoreState): void {
    if (prev.authSuppressedByUser !== next.authSuppressedByUser && next.authSuppressedByUser) {
      this.bus.emit("auth/signedOut", { by: "user" });
    }

    if (
      prev.githubAccountId &&
      next.githubAccountId &&
      prev.githubAccountId !== next.githubAccountId
    ) {
      this.bus.emit("auth/githubAccount.changed", {
        prevGithubAccountId: prev.githubAccountId,
        nextGithubAccountId: next.githubAccountId,
      });
    }

    const prevGithubUserId =
      "user" in prev.publicState ? (prev.publicState.user?.githubUserId ?? null) : null;
    const nextGithubUserId =
      "user" in next.publicState ? (next.publicState.user?.githubUserId ?? null) : null;
    if (prevGithubUserId !== nextGithubUserId) {
      this.bus.emit("auth/githubUser.changed", { prevGithubUserId, nextGithubUserId });
    }
  }

  private async execute(cmd: ChatClientCoreCommand): Promise<ChatClientCoreEvent | void> {
    switch (cmd.type) {
      case "cmd/github.session.get": {
        try {
          const session = cmd.interactive
            ? await getGitHubSession({
                interactive: true,
                ...(cmd.clearSessionPreference ? { clearSessionPreference: true } : {}),
              })
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
          if (result.error.type === "handshake_http_error") {
            const parts = [`HTTP ${result.error.status}`];
            if (typeof result.error.retryAfterMs === "number") {
              parts.push(`retryAfterMs=${result.error.retryAfterMs}`);
            }
            if (typeof result.error.bodyText === "string" && result.error.bodyText.length > 0) {
              const preview = result.error.bodyText.replaceAll(/\s+/g, " ").slice(0, 200);
              parts.push(`body="${preview}"`);
            }
            this.output.warn(`WebSocket handshake failed: ${parts.join(" ")}`);
          }
          return { type: "ws/open.result", ok: false, error: result.error, cause: result.cause };
        }

        this.ws = result.ws;
        this.wsHeartbeat = startWsHeartbeat({
          ws: result.ws,
          pingIntervalMs: WS_PING_INTERVAL_MS,
          pongTimeoutMs: WS_PONG_TIMEOUT_MS,
          onTimeout: ({ elapsedSinceLastPongMs }) => {
            this.output.warn(
              `WebSocket heartbeat timeout (no pong for ${elapsedSinceLastPongMs}ms). Terminating.`,
            );
          },
        });

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
    this.stopWsHeartbeat();
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

  private stopWsHeartbeat(): void {
    this.wsHeartbeat?.stop();
    this.wsHeartbeat = undefined;
  }
}
