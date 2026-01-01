import * as vscode from "vscode";
import WebSocket from "ws";
import {
  ClientEvent,
  ClientEventSchema,
  PROTOCOL_VERSION,
  ServerEventSchema,
} from "@vscode-chat/protocol";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type AuthStatus = "signedOut" | "signedIn";

export type ChatClientState = {
  authStatus: AuthStatus;
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
  private state: ChatClientState = { authStatus: "signedOut", status: "disconnected" };
  private listeners = new Set<(state: ChatClientState) => void>();
  private messageListeners = new Set<(event: unknown) => void>();
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;
  private readonly disposables: vscode.Disposable[] = [];

  private static readonly githubProviderId = "github";
  private static readonly githubScopes = ["read:user"] as const;

  constructor(private readonly output: vscode.LogOutputChannel) {}

  dispose(): void {
    this.stopReconnect();
    this.disconnect();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
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

  start(): void {
    this.disposables.push(
      vscode.authentication.onDidChangeSessions((e) => {
        if (e.provider.id !== ChatClient.githubProviderId) return;
        void this.refreshAuthState();
      }),
    );

    void this.refreshAuthState();
  }

  async refreshAuthState(): Promise<void> {
    const session = await this.getGitHubSession({ interactive: false });
    if (!session) {
      this.setAuthStatus("signedOut");
      return;
    }
    this.setAuthStatus("signedIn");
  }

  async signIn(): Promise<void> {
    await this.getGitHubSession({ interactive: true });
    this.setAuthStatus("signedIn");
    this.output.info("GitHub session acquired.");
  }

  async connect(): Promise<void> {
    await this.connectInteractive();
  }

  async connectInteractive(): Promise<void> {
    const backendUrl = this.getBackendUrl();
    this.stopReconnect();
    this.setState({ ...this.state, backendUrl, status: "connecting" });

    try {
      const githubSession = await this.getGitHubSession({ interactive: true });
      this.setAuthStatus("signedIn");
      await this.connectWithGitHubSession(backendUrl, githubSession);
    } catch (err) {
      this.setState({ ...this.state, status: "disconnected" });
      throw err;
    }
  }

  async connectIfSignedIn(): Promise<boolean> {
    const backendUrl = this.getBackendUrl();
    this.stopReconnect();

    const githubSession = await this.getGitHubSession({ interactive: false });
    if (!githubSession) {
      this.setAuthStatus("signedOut");
      return false;
    }

    this.setAuthStatus("signedIn");
    this.setState({ ...this.state, backendUrl, status: "connecting" });
    try {
      await this.connectWithGitHubSession(backendUrl, githubSession);
      return true;
    } catch (err) {
      this.setState({ ...this.state, status: "disconnected" });
      throw err;
    }
  }

  async signInAndConnect(): Promise<void> {
    const backendUrl = this.getBackendUrl();
    this.stopReconnect();

    const githubSession = await this.getGitHubSession({ interactive: true });
    this.setAuthStatus("signedIn");
    this.setState({ ...this.state, backendUrl, status: "connecting" });

    try {
      await this.connectWithGitHubSession(backendUrl, githubSession);
    } catch (err) {
      this.setState({ ...this.state, status: "disconnected" });
      throw err;
    }
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

  private async getGitHubSession(options: {
    interactive: true;
  }): Promise<vscode.AuthenticationSession>;
  private async getGitHubSession(options: {
    interactive: false;
  }): Promise<vscode.AuthenticationSession | undefined>;
  private async getGitHubSession(options: {
    interactive: boolean;
  }): Promise<vscode.AuthenticationSession | undefined> {
    if (options.interactive) {
      return vscode.authentication.getSession(
        ChatClient.githubProviderId,
        ChatClient.githubScopes,
        { createIfNone: true },
      );
    }

    return vscode.authentication.getSession(ChatClient.githubProviderId, ChatClient.githubScopes, {
      silent: true,
    });
  }

  private setAuthStatus(authStatus: AuthStatus): void {
    if (authStatus === this.state.authStatus) return;

    if (authStatus === "signedOut") {
      this.stopReconnect();
      this.closeSocket(1000, "auth_signed_out");
      this.sessionToken = undefined;
      const { user: _user, ...rest } = this.state;
      const next: ChatClientState = {
        ...rest,
        authStatus: "signedOut",
        status: "disconnected",
      };
      this.setState(next);
      return;
    }

    this.setState({ ...this.state, authStatus: "signedIn" });
  }

  private async connectWithGitHubSession(
    backendUrl: string,
    githubSession: vscode.AuthenticationSession,
  ): Promise<void> {
    const exchange = await this.exchangeToken(backendUrl, githubSession.accessToken).catch(
      (err) => {
        const msg = String(err);
        if (msg.includes("auth_exchange_failed_401") || msg.includes("auth_exchange_failed_403")) {
          this.setAuthStatus("signedOut");
        }
        throw err;
      },
    );
    this.sessionToken = exchange.token;

    this.setState({
      ...this.state,
      status: "connecting",
      backendUrl,
      user: { login: exchange.user.login, avatarUrl: exchange.user.avatarUrl },
    });

    await this.openWebSocket(backendUrl, exchange.token);
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
      if (this.autoConnectEnabled() && this.state.authStatus === "signedIn")
        this.scheduleReconnect();
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
        const attempted = await this.connectIfSignedIn();
        if (!attempted) return;
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
