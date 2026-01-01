import {
  ChatMessage,
  ChatMessageSchema,
  ClientEventSchema,
  PROTOCOL_VERSION,
  ServerEvent,
  ServerEventSchema,
} from "@vscode-chat/protocol";
import { verifySessionToken } from "./session.js";
import { getClientIp, parseBearerToken, parseGithubUserIdDenylist } from "./util.js";
import type { RateWindow } from "./util.js";
import {
  appendHistory as appendHistoryPolicy,
  createChatMessage,
  nextFixedWindowRateLimit,
} from "./policy/chatRoomPolicy.js";

type SocketAttachment = {
  user: {
    githubUserId: string;
    login: string;
    avatarUrl: string;
  };
};

const HISTORY_KEY = "history";
const HISTORY_LIMIT = 200;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_COUNT = 5;
const CONNECT_RATE_WINDOW_MS = 10_000;
const CONNECT_RATE_MAX_COUNT = 20;
const MAX_CONNECTIONS_PER_USER = 3;

export class ChatRoom implements DurableObject {
  private readonly historyReady: Promise<void>;
  private history: ChatMessage[] = [];
  private readonly rateByUser = new Map<string, RateWindow>();
  private readonly connectRateByIp = new Map<string, RateWindow>();
  private readonly deniedGithubUserIds: Set<string>;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: { SESSION_SECRET: string; DENY_GITHUB_USER_IDS?: string },
  ) {
    this.historyReady = this.loadHistory();
    this.deniedGithubUserIds = parseGithubUserIdDenylist(this.env.DENY_GITHUB_USER_IDS);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const clientIp = getClientIp(request);
    if (clientIp) {
      const rateCheck = this.checkConnectRateLimit(clientIp);
      if (!rateCheck.allowed) {
        this.log({ type: "ws_connect_rate_limited", retryAfterMs: rateCheck.retryAfterMs });
        return new Response("Too many connection attempts", {
          status: 429,
          headers: { "retry-after": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        });
      }
    }

    const token = parseBearerToken(request.headers.get("Authorization"));
    if (!token) {
      return new Response("Missing token", { status: 401 });
    }

    let user: SocketAttachment["user"];
    try {
      user = await verifySessionToken(token, this.env);
    } catch {
      return new Response("Invalid token", { status: 401 });
    }

    if (this.deniedGithubUserIds.has(user.githubUserId)) {
      this.log({ type: "ws_connect_denied" });
      return new Response("Forbidden", { status: 403 });
    }

    const activeConnections = countConnectionsForUser(
      this.state.getWebSockets(),
      user.githubUserId,
    );
    if (activeConnections >= MAX_CONNECTIONS_PER_USER) {
      this.log({ type: "ws_connect_too_many_connections" });
      return new Response("Too many connections", { status: 429 });
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
          this.log({ type: "chat_rate_limited", retryAfterMs: rateCheck.retryAfterMs });
          this.sendError(ws, {
            code: "rate_limited",
            message: "Too many messages",
            retryAfterMs: rateCheck.retryAfterMs,
          });
          return;
        }

        const newMessage = createChatMessage({
          id: crypto.randomUUID(),
          user,
          text: parsed.data.text,
          createdAt: new Date().toISOString(),
        });

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
    const saved = await this.state.storage.get<unknown>(HISTORY_KEY);
    if (!Array.isArray(saved)) return;

    const valid: ChatMessage[] = [];
    for (const item of saved) {
      const parsed = ChatMessageSchema.safeParse(item);
      if (parsed.success) valid.push(parsed.data);
    }

    this.history = valid.slice(-HISTORY_LIMIT);
  }

  private async appendHistory(message: ChatMessage): Promise<void> {
    this.history = appendHistoryPolicy(this.history, message, HISTORY_LIMIT);
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
    const nowMs = Date.now();
    const decision = nextFixedWindowRateLimit(this.rateByUser.get(githubUserId), nowMs, {
      windowMs: RATE_WINDOW_MS,
      maxCount: RATE_MAX_COUNT,
    });

    this.rateByUser.set(githubUserId, decision.nextWindow);
    return decision.allowed
      ? { allowed: true }
      : { allowed: false, retryAfterMs: decision.retryAfterMs };
  }

  private checkConnectRateLimit(
    key: string,
  ): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const nowMs = Date.now();
    const decision = nextFixedWindowRateLimit(this.connectRateByIp.get(key), nowMs, {
      windowMs: CONNECT_RATE_WINDOW_MS,
      maxCount: CONNECT_RATE_MAX_COUNT,
    });

    this.connectRateByIp.set(key, decision.nextWindow);
    return decision.allowed
      ? { allowed: true }
      : { allowed: false, retryAfterMs: decision.retryAfterMs };
  }

  private log(event: Record<string, unknown>): void {
    // NOTE: Keep logs structured and privacy-preserving. Never include tokens or message text.
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        ...event,
      }),
    );
  }
}

function countConnectionsForUser(webSockets: WebSocket[], githubUserId: string): number {
  let count = 0;
  for (const ws of webSockets) {
    try {
      const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
      if (attachment?.user.githubUserId === githubUserId) count += 1;
    } catch {
      // ignore
    }
  }
  return count;
}
