import { z } from "zod";
import {
  ClientEventSchema,
  DmIdSchema,
  DmIdentitySchema,
  DmMessageCipherSchema,
  GithubUserIdSchema,
  PROTOCOL_VERSION,
  ServerEventSchema,
  type AuthUser,
  type ChatMessagePlain,
  type DmId,
  type DmIdentity,
  type DmMessageCipher,
  type GithubUserId,
  type ServerEvent,
  type WsHandshakeRejection,
} from "@vscode-chat/protocol";
import { parseServerConfig, type ChatRoomGuardrails } from "../config.js";
import { verifySessionToken } from "../session.js";
import { getClientIp, parseBearerToken } from "../util.js";
import { createChatMessagePlain } from "../policy/chatRoomPolicy.js";
import {
  WS_MAX_CONSECUTIVE_INVALID_PAYLOADS,
  WS_MAX_INBOUND_MESSAGE_BYTES,
  type SocketAttachment,
} from "./constants.js";
import { tryGetSocketUser } from "../socketAttachment.js";
import { ChatRoomHistory } from "./history.js";
import { ChatRoomModeration } from "./moderation.js";
import { ChatRoomPresence } from "./presence.js";
import { ChatRoomRateLimits } from "./rateLimits.js";
import { countConnectionsForUser } from "./util.js";

const DM_ID_RE = /^dm:v1:([1-9][0-9]*):([1-9][0-9]*)$/;
const DM_IDENTITIES_KEY = "dm_identities";

const DmIdentitiesStorageSchema = z.record(z.string(), DmIdentitySchema);
const DmHistoryResponseSchema = z.object({ history: z.array(DmMessageCipherSchema) });

function assertNever(_value: never): never {
  throw new Error("unreachable");
}

function compareNumericStrings(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : 1;
}

function toDmId(a: GithubUserId, b: GithubUserId): DmId {
  const dmIdRaw = compareNumericStrings(a, b) <= 0 ? `dm:v1:${a}:${b}` : `dm:v1:${b}:${a}`;
  return DmIdSchema.parse(dmIdRaw);
}

function parseDmId(dmId: DmId): { a: GithubUserId; b: GithubUserId } | undefined {
  const match = DM_ID_RE.exec(dmId);
  if (!match) return undefined;

  const aRaw = match[1];
  const bRaw = match[2];
  if (!aRaw || !bRaw) return undefined;

  const a = GithubUserIdSchema.safeParse(aRaw);
  if (!a.success) return undefined;
  const b = GithubUserIdSchema.safeParse(bRaw);
  if (!b.success) return undefined;

  if (compareNumericStrings(a.data, b.data) > 0) return undefined;
  return { a: a.data, b: b.data };
}

function jsonWsHandshakeRejection(
  payload: WsHandshakeRejection,
  init: { status: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

export class ChatRoom implements DurableObject {
  private readonly config: ChatRoomGuardrails;

  private readonly history: ChatRoomHistory;
  private readonly rateLimits: ChatRoomRateLimits;
  private readonly moderation: ChatRoomModeration;
  private readonly presence: ChatRoomPresence;
  private readonly dmIdentities = new Map<GithubUserId, DmIdentity>();
  private readonly dmIdentitiesReady: Promise<void>;

  private readonly moderatorGithubUserIds: ReadonlySet<GithubUserId>;
  private readonly invalidPayloadStrikes = new WeakMap<WebSocket, number>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: {
      DM_ROOM: DurableObjectNamespace;
      SESSION_SECRET: string;
      DENY_GITHUB_USER_IDS?: string;
      MODERATOR_GITHUB_USER_IDS?: string;
    } & Record<string, unknown>,
  ) {
    const configParsed = parseServerConfig(this.env);
    if (!configParsed.ok) {
      this.log({ type: "invalid_config", issues: configParsed.error.issues, scope: "chat_room" });
      throw new Error("invalid_config");
    }

    this.config = configParsed.config.chatRoom;

    this.history = new ChatRoomHistory(this.state, this.config);
    this.rateLimits = new ChatRoomRateLimits(this.config);

    this.moderatorGithubUserIds = configParsed.config.moderatorGithubUserIds;
    this.moderation = new ChatRoomModeration(
      this.state,
      configParsed.config.operatorDeniedGithubUserIds,
      () => this.state.getWebSockets(),
      (ws, event) => this.sendEvent(ws, event),
      (ws, err) => this.sendError(ws, err),
      (event) => this.log(event),
    );

    this.presence = new ChatRoomPresence(
      () => this.state.getWebSockets(),
      (event) => this.broadcast(event),
    );

    this.dmIdentitiesReady = this.loadDmIdentities();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const clientIp = getClientIp(request);
    if (clientIp) {
      const rateCheck = this.rateLimits.checkConnectRateLimit(clientIp);
      if (!rateCheck.allowed) {
        this.log({ type: "ws_connect_rate_limited", retryAfterMs: rateCheck.retryAfterMs });
        return jsonWsHandshakeRejection(
          {
            code: "rate_limited",
            message: "Too many connection attempts",
            retryAfterMs: rateCheck.retryAfterMs,
          } satisfies WsHandshakeRejection,
          {
            status: 429,
            headers: { "retry-after": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
          },
        );
      }
    }

    const token = parseBearerToken(request.headers.get("Authorization"));
    if (!token) {
      return new Response("Missing token", { status: 401 });
    }

    let user: SocketAttachment["user"];
    try {
      const verified = await verifySessionToken(token, this.env);
      const roles: AuthUser["roles"] = this.moderatorGithubUserIds.has(verified.githubUserId)
        ? ["moderator"]
        : [];
      user = { ...verified, roles };
    } catch {
      return new Response("Invalid token", { status: 401 });
    }

    await this.moderation.ready;

    if (this.moderation.isDeniedGithubUserId(user.githubUserId)) {
      this.log({ type: "ws_connect_denied", githubUserId: user.githubUserId });
      return new Response("Forbidden", { status: 403 });
    }

    const maxConnectionsPerRoom = this.config.maxConnectionsPerRoom;
    if (maxConnectionsPerRoom !== undefined) {
      const activeRoomConnections = this.state.getWebSockets().length;
      if (activeRoomConnections >= maxConnectionsPerRoom) {
        this.log({ type: "ws_connect_room_full", maxConnectionsPerRoom });
        return jsonWsHandshakeRejection(
          { code: "room_full", message: "Room is full" } satisfies WsHandshakeRejection,
          { status: 429 },
        );
      }
    }

    const activeConnections = countConnectionsForUser(
      this.state.getWebSockets(),
      user.githubUserId,
    );
    if (activeConnections >= this.config.maxConnectionsPerUser) {
      this.log({ type: "ws_connect_too_many_connections" });
      return jsonWsHandshakeRejection(
        {
          code: "too_many_connections",
          message: "Too many connections",
        } satisfies WsHandshakeRejection,
        { status: 429 },
      );
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.serializeAttachment({ user } satisfies SocketAttachment);
    this.state.acceptWebSocket(server);

    await this.history.ready;

    this.sendEvent(server, {
      version: PROTOCOL_VERSION,
      type: "server/welcome",
      user,
      serverTime: new Date().toISOString(),
      history: this.history.snapshot(),
    } satisfies ServerEvent);

    this.presence.request();

    if (this.moderation.isModerator(user)) {
      this.moderation.sendSnapshot(server);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Best-effort: bound inbound message size before attempting JSON parsing.
    // For strings, treat the limit as a conservative upper bound in UTF-16 code units.
    if (
      (typeof message === "string" && message.length > WS_MAX_INBOUND_MESSAGE_BYTES) ||
      (message instanceof ArrayBuffer && message.byteLength > WS_MAX_INBOUND_MESSAGE_BYTES)
    ) {
      ws.close(1009, "message_too_big");
      return;
    }

    const text = typeof message === "string" ? message : new TextDecoder().decode(message);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.handleInvalidPayload(ws, "Invalid JSON");
      return;
    }

    const parsed = ClientEventSchema.safeParse(json);
    if (!parsed.success) {
      this.handleInvalidPayload(ws, "Invalid event schema");
      return;
    }

    this.invalidPayloadStrikes.delete(ws);

    const user = tryGetSocketUser(ws);
    if (!user) {
      this.sendError(ws, { code: "server_error", message: "Missing connection identity" });
      ws.close(1011, "server_error");
      return;
    }

    switch (parsed.data.type) {
      case "client/hello": {
        // No-op: the authenticated identity is already bound at the WebSocket upgrade boundary.
        return;
      }

      case "client/message.send": {
        const rateCheck = this.rateLimits.checkMessageRateLimit(user.githubUserId);
        if (!rateCheck.allowed) {
          this.log({ type: "chat_rate_limited", retryAfterMs: rateCheck.retryAfterMs });
          this.sendError(ws, {
            code: "rate_limited",
            message: "Too many messages",
            retryAfterMs: rateCheck.retryAfterMs,
          });
          return;
        }

        const newMessage: ChatMessagePlain = createChatMessagePlain({
          id: crypto.randomUUID(),
          user,
          text: parsed.data.text,
          createdAt: new Date().toISOString(),
        });

        await this.history.append(newMessage);
        this.broadcast({
          version: PROTOCOL_VERSION,
          type: "server/message.new",
          message: newMessage,
        } satisfies ServerEvent);
        return;
      }

      case "client/dm.identity.publish": {
        await this.dmIdentitiesReady;
        await this.storeDmIdentity(user.githubUserId, parsed.data.identity);
        return;
      }

      case "client/dm.open": {
        await this.dmIdentitiesReady;
        if (parsed.data.targetGithubUserId === user.githubUserId) {
          this.sendError(ws, { code: "invalid_payload", message: "Cannot DM self" });
          return;
        }

        const dmId = toDmId(user.githubUserId, parsed.data.targetGithubUserId);
        const history = await this.readDmHistory(dmId);
        const peerIdentity = this.dmIdentities.get(parsed.data.targetGithubUserId);

        this.sendEvent(ws, {
          version: PROTOCOL_VERSION,
          type: "server/dm.welcome",
          dmId,
          peerGithubUserId: parsed.data.targetGithubUserId,
          ...(peerIdentity ? { peerIdentity } : {}),
          history,
        } satisfies ServerEvent);
        return;
      }

      case "client/dm.message.send": {
        const rateCheck = this.rateLimits.checkMessageRateLimit(user.githubUserId);
        if (!rateCheck.allowed) {
          this.log({ type: "dm_rate_limited", retryAfterMs: rateCheck.retryAfterMs });
          this.sendError(ws, {
            code: "rate_limited",
            message: "Too many messages",
            retryAfterMs: rateCheck.retryAfterMs,
          });
          return;
        }

        const parsedDm = parseDmId(parsed.data.dmId);
        if (!parsedDm) {
          this.sendError(ws, { code: "invalid_payload", message: "Invalid dmId" });
          return;
        }

        const peerGithubUserId =
          user.githubUserId === parsedDm.a
            ? parsedDm.b
            : user.githubUserId === parsedDm.b
              ? parsedDm.a
              : undefined;
        if (!peerGithubUserId) {
          this.sendError(ws, { code: "forbidden", message: "Not a DM participant" });
          return;
        }

        if (peerGithubUserId !== parsed.data.recipientGithubUserId) {
          this.sendError(ws, { code: "invalid_payload", message: "DM recipient mismatch" });
          return;
        }

        const now = new Date().toISOString();
        const newMessage: DmMessageCipher = {
          id: crypto.randomUUID(),
          dmId: parsed.data.dmId,
          sender: user,
          recipientGithubUserId: peerGithubUserId,
          senderIdentity: parsed.data.senderIdentity,
          recipientIdentity: parsed.data.recipientIdentity,
          nonce: parsed.data.nonce,
          ciphertext: parsed.data.ciphertext,
          createdAt: now,
        };

        await this.appendDmHistory(parsed.data.dmId, newMessage);

        this.broadcastToUsers(new Set([user.githubUserId, peerGithubUserId]), {
          version: PROTOCOL_VERSION,
          type: "server/dm.message.new",
          message: newMessage,
        } satisfies ServerEvent);
        return;
      }

      case "client/moderation.user.deny": {
        await this.moderation.handleUserDeny(ws, user, parsed.data.targetGithubUserId);
        return;
      }
      case "client/moderation.user.allow": {
        await this.moderation.handleUserAllow(ws, user, parsed.data.targetGithubUserId);
        return;
      }
      default: {
        return assertNever(parsed.data);
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    // Best-effort: state.getWebSockets() excludes closed sockets eventually.
    // Exclude the socket explicitly to avoid transient over-counting.
    this.presence.request({ exclude: ws });
  }

  webSocketError(_ws: WebSocket): void {
    // no-op
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

  private broadcastToUsers(githubUserIds: ReadonlySet<GithubUserId>, event: ServerEvent): void {
    const json = JSON.stringify(event);
    for (const socket of this.state.getWebSockets()) {
      const socketUser = tryGetSocketUser(socket);
      if (!socketUser) continue;
      if (!githubUserIds.has(socketUser.githubUserId)) continue;
      try {
        socket.send(json);
      } catch {
        // ignore
      }
    }
  }

  private sendEvent(ws: WebSocket, event: ServerEvent): void {
    const parsed = ServerEventSchema.safeParse(event);
    if (!parsed.success) return;

    try {
      ws.send(JSON.stringify(event));
    } catch {
      // ignore
    }
  }

  private sendError(
    ws: WebSocket,
    err: Pick<Extract<ServerEvent, { type: "server/error" }>, "code" | "message" | "retryAfterMs">,
  ): void {
    this.sendEvent(ws, {
      version: PROTOCOL_VERSION,
      type: "server/error",
      ...err,
    } satisfies ServerEvent);
  }

  private handleInvalidPayload(ws: WebSocket, message: string): void {
    const strikes = (this.invalidPayloadStrikes.get(ws) ?? 0) + 1;
    this.invalidPayloadStrikes.set(ws, strikes);

    this.sendError(ws, { code: "invalid_payload", message });

    if (strikes >= WS_MAX_CONSECUTIVE_INVALID_PAYLOADS) {
      try {
        ws.close(1008, "invalid_payload");
      } catch {
        // ignore
      }
    }
  }

  private async loadDmIdentities(): Promise<void> {
    const saved = await this.state.storage.get<unknown>(DM_IDENTITIES_KEY);
    const parsed = DmIdentitiesStorageSchema.safeParse(saved);
    if (!parsed.success) return;
    for (const [githubUserId, identity] of Object.entries(parsed.data)) {
      const githubUserIdParsed = GithubUserIdSchema.safeParse(githubUserId);
      if (!githubUserIdParsed.success) continue;
      this.dmIdentities.set(githubUserIdParsed.data, identity);
    }
  }

  private async storeDmIdentity(githubUserId: GithubUserId, identity: DmIdentity): Promise<void> {
    this.dmIdentities.set(githubUserId, identity);
    await this.state.storage.put(DM_IDENTITIES_KEY, Object.fromEntries(this.dmIdentities));
  }

  private async readDmHistory(dmId: DmId): Promise<DmMessageCipher[]> {
    const stub = this.env.DM_ROOM.get(this.env.DM_ROOM.idFromName(dmId));
    const response = await stub.fetch("https://dm-room/history");
    if (!response.ok) return [];

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return [];
    }

    const parsed = DmHistoryResponseSchema.safeParse(json);
    return parsed.success ? parsed.data.history : [];
  }

  private async appendDmHistory(dmId: DmId, message: DmMessageCipher): Promise<void> {
    const stub = this.env.DM_ROOM.get(this.env.DM_ROOM.idFromName(dmId));
    await stub.fetch("https://dm-room/append", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(message),
    });
  }

  private log(event: Record<string, unknown>): void {
    // NOTE: Keep logs structured and privacy-preserving. Never include tokens or chat message plaintext.
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        ...event,
      }),
    );
  }
}
