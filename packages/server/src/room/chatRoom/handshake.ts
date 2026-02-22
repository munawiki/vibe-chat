import type {
  AuthUser,
  GithubUserId,
  ServerEvent,
  WsHandshakeRejection,
} from "@vscode-chat/protocol";
import { PROTOCOL_VERSION } from "@vscode-chat/protocol";
import type { ChatRoomGuardrails } from "../../config.js";
import { verifySessionToken } from "../../session.js";
import { getClientIp, parseBearerToken } from "../../util.js";
import type { SocketAttachment } from "../constants.js";
import type { ChatRoomHistory } from "../history.js";
import type { ChatRoomModeration } from "../moderation.js";
import type { ChatRoomPresence } from "../presence.js";
import type { ChatRoomRateLimits } from "../rateLimits.js";
import { countConnectionsForUser } from "../util.js";

function jsonWsHandshakeRejection(
  payload: WsHandshakeRejection,
  init: { status: number; headers?: Record<string, string> },
): Response {
  const headers = init.headers
    ? { "content-type": "application/json; charset=utf-8", ...init.headers }
    : { "content-type": "application/json; charset=utf-8" };
  return new Response(JSON.stringify(payload), {
    status: init.status,
    headers,
  });
}

export async function handleChatRoomFetchWebSocketHandshake(
  request: Request,
  options: {
    state: DurableObjectState;
    env: { SESSION_SECRET: string } & Record<string, unknown>;
    config: ChatRoomGuardrails;
    moderatorGithubUserIds: ReadonlySet<GithubUserId>;
    history: ChatRoomHistory;
    rateLimits: ChatRoomRateLimits;
    moderation: ChatRoomModeration;
    presence: ChatRoomPresence;
    sendEvent: (ws: WebSocket, event: ServerEvent) => void;
    log: (event: Record<string, unknown>) => void;
  },
): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }

  const clientIp = getClientIp(request);
  if (clientIp) {
    const rateCheck = options.rateLimits.checkConnectRateLimit(clientIp);
    if (!rateCheck.allowed) {
      options.log({ type: "ws_connect_rate_limited", retryAfterMs: rateCheck.retryAfterMs });
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
    const verified = await verifySessionToken(token, options.env);
    const roles: AuthUser["roles"] = options.moderatorGithubUserIds.has(verified.githubUserId)
      ? ["moderator"]
      : [];
    user = { ...verified, roles };
  } catch {
    return new Response("Invalid token", { status: 401 });
  }

  await options.moderation.ready;

  if (options.moderation.isDeniedGithubUserId(user.githubUserId)) {
    options.log({ type: "ws_connect_denied", githubUserId: user.githubUserId });
    return new Response("Forbidden", { status: 403 });
  }

  const maxConnectionsPerRoom = options.config.maxConnectionsPerRoom;
  if (maxConnectionsPerRoom !== undefined) {
    const activeRoomConnections = options.state.getWebSockets().length;
    if (activeRoomConnections >= maxConnectionsPerRoom) {
      options.log({ type: "ws_connect_room_full", maxConnectionsPerRoom });
      return jsonWsHandshakeRejection(
        { code: "room_full", message: "Room is full" } satisfies WsHandshakeRejection,
        { status: 429 },
      );
    }
  }

  const activeConnections = countConnectionsForUser(
    options.state.getWebSockets(),
    user.githubUserId,
  );
  if (activeConnections >= options.config.maxConnectionsPerUser) {
    options.log({ type: "ws_connect_too_many_connections" });
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
  options.state.acceptWebSocket(server);

  await options.history.ready;

  options.sendEvent(server, {
    version: PROTOCOL_VERSION,
    type: "server/welcome",
    user,
    serverTime: new Date().toISOString(),
    history: options.history.snapshot(),
  } satisfies ServerEvent);

  options.presence.request();

  if (options.moderation.isModerator(user)) {
    options.moderation.sendSnapshot(server);
  }

  return new Response(null, { status: 101, webSocket: client });
}
