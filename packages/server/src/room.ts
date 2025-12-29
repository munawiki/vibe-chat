import {
  ChatMessage,
  ClientEventSchema,
  PROTOCOL_VERSION,
  ServerEvent,
  ServerEventSchema,
} from "@vscode-chat/protocol";
import { verifySessionToken } from "./session.js";

type SocketAttachment = {
  user: {
    githubUserId: string;
    login: string;
    avatarUrl: string;
  };
};

type RateWindow = {
  windowStartMs: number;
  count: number;
};

const HISTORY_KEY = "history";
const HISTORY_LIMIT = 200;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_COUNT = 5;

export class ChatRoom implements DurableObject {
  private readonly historyReady: Promise<void>;
  private history: ChatMessage[] = [];
  private readonly rateByUser = new Map<string, RateWindow>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: { SESSION_SECRET: string },
  ) {
    this.historyReady = this.loadHistory();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    if (!token) {
      return new Response("Missing token", { status: 401 });
    }

    let user: SocketAttachment["user"];
    try {
      user = await verifySessionToken(token, this.env);
    } catch {
      return new Response("Invalid token", { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.serializeAttachment({ user } satisfies SocketAttachment);
    this.state.acceptWebSocket(server);

    await this.historyReady;

    server.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "server/welcome",
        user,
        serverTime: new Date().toISOString(),
        history: this.history,
      } satisfies ServerEvent),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.sendError(ws, { code: "invalid_payload", message: "Invalid JSON" });
      return;
    }

    const parsed = ClientEventSchema.safeParse(json);
    if (!parsed.success) {
      this.sendError(ws, { code: "invalid_payload", message: "Invalid event schema" });
      return;
    }

    const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
    const user = attachment?.user;
    if (!user) {
      this.sendError(ws, { code: "server_error", message: "Missing connection identity" });
      ws.close(1011, "server_error");
      return;
    }

    switch (parsed.data.type) {
      case "client/hello":
        return;
      case "client/message.send": {
        const rateCheck = this.checkRateLimit(user.githubUserId);
        if (!rateCheck.allowed) {
          this.sendError(ws, {
            code: "rate_limited",
            message: "Too many messages",
            retryAfterMs: rateCheck.retryAfterMs,
          });
          return;
        }

        const newMessage: ChatMessage = {
          id: crypto.randomUUID(),
          user,
          text: parsed.data.text,
          createdAt: new Date().toISOString(),
        };

        await this.appendHistory(newMessage);
        this.broadcast({
          version: PROTOCOL_VERSION,
          type: "server/message.new",
          message: newMessage,
        } satisfies ServerEvent);
        return;
      }
    }
  }

  async webSocketClose(_ws: WebSocket): Promise<void> {
    // no-op: state.getWebSockets() excludes closed sockets eventually.
  }

  async webSocketError(_ws: WebSocket): Promise<void> {
    // no-op
  }

  private async loadHistory(): Promise<void> {
    const saved = await this.state.storage.get<ChatMessage[]>(HISTORY_KEY);
    if (Array.isArray(saved)) {
      this.history = saved;
    }
  }

  private async appendHistory(message: ChatMessage): Promise<void> {
    this.history = [...this.history, message].slice(-HISTORY_LIMIT);
    await this.state.storage.put(HISTORY_KEY, this.history);
  }

  private broadcast(event: ServerEvent): void {
    const json = JSON.stringify(event);
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(json);
      } catch {
        // ignore
      }
    }
  }

  private sendError(
    ws: WebSocket,
    err: Pick<Extract<ServerEvent, { type: "server/error" }>, "code" | "message" | "retryAfterMs">,
  ): void {
    const event: ServerEvent = {
      version: PROTOCOL_VERSION,
      type: "server/error",
      ...err,
    };

    const parsed = ServerEventSchema.safeParse(event);
    if (!parsed.success) {
      return;
    }

    try {
      ws.send(JSON.stringify(event));
    } catch {
      // ignore
    }
  }

  private checkRateLimit(
    githubUserId: string,
  ): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const now = Date.now();
    const window = this.rateByUser.get(githubUserId);

    if (!window || now - window.windowStartMs >= RATE_WINDOW_MS) {
      this.rateByUser.set(githubUserId, { windowStartMs: now, count: 1 });
      return { allowed: true };
    }

    if (window.count >= RATE_MAX_COUNT) {
      const retryAfterMs = Math.max(0, RATE_WINDOW_MS - (now - window.windowStartMs));
      return { allowed: false, retryAfterMs };
    }

    window.count += 1;
    this.rateByUser.set(githubUserId, window);
    return { allowed: true };
  }
}
