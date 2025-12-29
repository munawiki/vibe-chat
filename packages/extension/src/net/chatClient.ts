import * as vscode from "vscode";
import WebSocket from "ws";
import {
  ClientEvent,
  ClientEventSchema,
  PROTOCOL_VERSION,
  ServerEventSchema,
} from "@vscode-chat/protocol";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type ChatClientState = {
  status: ConnectionStatus;
  backendUrl?: string;
  user?: { login: string; avatarUrl: string };
};

type SessionExchangeResponse = {
  token: string;
  expiresAt: string;
  user: { githubUserId: string; login: string; avatarUrl: string };
};

export class ChatClient implements vscode.Disposable {
  private ws: WebSocket | undefined;
  private sessionToken: string | undefined;
  private state: ChatClientState = { status: "disconnected" };
  private listeners = new Set<(state: ChatClientState) => void>();
  private messageListeners = new Set<(event: unknown) => void>();
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;

  constructor(private readonly output: vscode.LogOutputChannel) {}

  dispose(): void {
    this.stopReconnect();
    this.disconnect();
  }

  onState(listener: (state: ChatClientState) => void): vscode.Disposable {
    this.listeners.add(listener);
    listener(this.state);
    return { dispose: () => this.listeners.delete(listener) };
  }

  onEvent(listener: (event: unknown) => void): vscode.Disposable {
    this.messageListeners.add(listener);
    return { dispose: () => this.messageListeners.delete(listener) };
  }

  getState(): ChatClientState {
    return this.state;
  }

  async signIn(): Promise<void> {
    await vscode.authentication.getSession("github", ["read:user"], { createIfNone: true });
    this.output.info("GitHub session acquired.");
  }

  async connect(): Promise<void> {
    this.stopReconnect();
    const backendUrl = this.getBackendUrl();
    this.setState({ ...this.state, backendUrl, status: "connecting" });

    const githubSession = await vscode.authentication.getSession("github", ["read:user"], {
      createIfNone: true,
    });
    const exchange = await this.exchangeToken(backendUrl, githubSession.accessToken);
    this.sessionToken = exchange.token;

    this.setState({
      status: "connecting",
      backendUrl,
      user: { login: exchange.user.login, avatarUrl: exchange.user.avatarUrl },
    });

    await this.openWebSocket(backendUrl, exchange.token);
  }

  disconnect(): void {
    this.stopReconnect();
    this.closeSocket(1000, "client_disconnect");
    this.sessionToken = undefined;
    this.setState({ ...this.state, status: "disconnected" });
  }

  sendMessage(text: string): void {
    const payload: ClientEvent = { version: PROTOCOL_VERSION, type: "client/message.send", text };
    const parsed = ClientEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.output.warn("Rejected client payload by schema.");
      return;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.output.warn("WebSocket not open.");
      return;
    }
    this.ws.send(JSON.stringify(payload));
  }

  private getBackendUrl(): string {
    const cfg = vscode.workspace.getConfiguration("vscodeChat");
    const url = cfg.get<string>("backendUrl");
    if (!url) {
      throw new Error("vscodeChat.backendUrl is required");
    }
    return url.replace(/\/+$/, "");
  }

  private autoConnectEnabled(): boolean {
    return vscode.workspace.getConfiguration("vscodeChat").get<boolean>("autoConnect", true);
  }

  private async exchangeToken(
    backendUrl: string,
    accessToken: string,
  ): Promise<SessionExchangeResponse> {
    const url = `${backendUrl}/auth/exchange`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`auth_exchange_failed_${response.status}: ${text}`);
    }

    const json = (await response.json()) as unknown;
    // minimal structural check (server already validates strictly)
    if (!json || typeof json !== "object") {
      throw new Error("auth_exchange_invalid_response");
    }
    return json as SessionExchangeResponse;
  }

  private async openWebSocket(backendUrl: string, token: string): Promise<void> {
    this.closeSocket(1000, "reconnect");

    const wsUrl = backendUrl.replace(/^http/, "ws") + `/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempt = 0;
      this.setState({ ...this.state, status: "connected" });
      ws.send(
        JSON.stringify({
          version: PROTOCOL_VERSION,
          type: "client/hello",
          client: { name: "vscode", version: vscode.version },
        } satisfies ClientEvent),
      );
    });

    ws.on("message", (data) => {
      if (ws !== this.ws) return;
      const text = typeof data === "string" ? data : data.toString("utf8");
      let json: unknown;
      try {
        json = JSON.parse(text);
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
    });

    ws.on("close", (code, reason) => {
      if (ws !== this.ws) return;
      this.output.warn(`WebSocket closed: ${code} ${reason.toString()}`);
      this.ws = undefined;
      this.setState({ ...this.state, status: "disconnected" });
      if (this.autoConnectEnabled()) this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      if (ws !== this.ws) return;
      this.output.error(`WebSocket error: ${String(err)}`);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const attempt = Math.min(this.reconnectAttempt, 6);
    const delayMs = Math.min(30_000, 500 * Math.pow(2, attempt));
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.connect();
      } catch (err) {
        this.output.warn(`Reconnect failed: ${String(err)}`);
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private closeSocket(code: number, reason: string): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = undefined;
    try {
      ws.close(code, reason);
    } catch {
      // ignore
    }
  }

  private setState(next: ChatClientState): void {
    this.state = next;
    for (const listener of this.listeners) listener(this.state);
  }
}
