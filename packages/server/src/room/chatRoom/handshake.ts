import type { GithubUserId, ServerEvent, WsHandshakeRejection } from "@vscode-chat/protocol";
import { PROTOCOL_VERSION } from "@vscode-chat/protocol";
import type { ChatRoomGuardrails } from "../../config.js";
import { verifySessionToken } from "../../session.js";
import type { SocketAttachment } from "../../socketAttachment.js";
import { getClientIp, parseBearerToken } from "../../util/headers.js";
import type { ChatRoomHistory } from "../history.js";
import type { ChatRoomModeration } from "../moderation.js";
import type { ChatRoomRateLimits } from "../rateLimits.js";
import { countConnectionsForUser } from "../util.js";
import type { ChatRoomPresence } from "./presence.js";
import type { ChatRoomSession } from "./session.js";

export type HandshakeContext = {
  state: DurableObjectState;
  config: ChatRoomGuardrails;
  session: ChatRoomSession;
  env: { SESSION_SECRET: string } & Record<string, unknown>;
  moderatorGithubUserIds: ReadonlySet<GithubUserId>;
  history: ChatRoomHistory;
  rateLimits: ChatRoomRateLimits;
  moderation: ChatRoomModeration;
  presence: ChatRoomPresence;
  sendEvent: (ws: WebSocket, event: ServerEvent) => void;
  log: (event: Record<string, unknown>) => void;
};

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

export function validateUpgrade(request: Request): Response | undefined {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }
  return undefined;
}

function checkConnectRateLimit(request: Request, context: HandshakeContext): Response | undefined {
  const clientIp = getClientIp(request);
  if (!clientIp) return undefined;

  const rateCheck = context.rateLimits.checkConnectRateLimit(clientIp);
  if (rateCheck.allowed) return undefined;

  context.log({ type: "ws_connect_rate_limited", retryAfterMs: rateCheck.retryAfterMs });
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

export async function verifySession(
  request: Request,
  context: Pick<HandshakeContext, "env" | "moderatorGithubUserIds" | "session">,
): Promise<{ user: SocketAttachment["user"] } | { response: Response }> {
  const token = parseBearerToken(request.headers.get("Authorization"));
  if (!token) return { response: new Response("Missing token", { status: 401 }) };

  try {
    const verified = await verifySessionToken(token, context.env);
    return { user: context.session.toSocketUser(verified, context.moderatorGithubUserIds) };
  } catch {
    return { response: new Response("Invalid token", { status: 401 }) };
  }
}

export function checkModerationStatus(
  moderation: ChatRoomModeration,
  user: SocketAttachment["user"],
  log: (event: Record<string, unknown>) => void,
): Response | undefined {
  if (!moderation.isDeniedGithubUserId(user.githubUserId)) return undefined;

  log({ type: "ws_connect_denied", githubUserId: user.githubUserId });
  return new Response("Forbidden", { status: 403 });
}

export function checkConnectionLimits(
  state: DurableObjectState,
  config: ChatRoomGuardrails,
  user: SocketAttachment["user"],
  log: (event: Record<string, unknown>) => void,
): Response | undefined {
  const maxConnectionsPerRoom = config.maxConnectionsPerRoom;
  const sockets = state.getWebSockets();
  if (maxConnectionsPerRoom !== undefined && sockets.length >= maxConnectionsPerRoom) {
    log({ type: "ws_connect_room_full", maxConnectionsPerRoom });
    return jsonWsHandshakeRejection(
      { code: "room_full", message: "Room is full" } satisfies WsHandshakeRejection,
      { status: 429 },
    );
  }

  const activeConnections = countConnectionsForUser(sockets, user.githubUserId);
  if (activeConnections >= config.maxConnectionsPerUser) {
    log({ type: "ws_connect_too_many_connections" });
    return jsonWsHandshakeRejection(
      {
        code: "too_many_connections",
        message: "Too many connections",
      } satisfies WsHandshakeRejection,
      { status: 429 },
    );
  }

  return undefined;
}

async function acceptWebSocket(
  user: SocketAttachment["user"],
  context: HandshakeContext,
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

  context.session.attachSocketUser(server, user);
  context.state.acceptWebSocket(server);

  await context.history.ready;
  context.sendEvent(server, {
    version: PROTOCOL_VERSION,
    type: "server/welcome",
    user,
    serverTime: new Date().toISOString(),
    history: context.history.snapshot(),
  } satisfies ServerEvent);

  context.presence.request();
  if (context.moderation.isModerator(user)) {
    context.moderation.sendSnapshot(server);
  }

  return new Response(null, { status: 101, webSocket: client });
}

export async function handleChatRoomFetchWebSocketHandshake(
  request: Request,
  context: HandshakeContext,
): Promise<Response> {
  const invalidUpgrade = validateUpgrade(request);
  if (invalidUpgrade) return invalidUpgrade;

  const rateLimited = checkConnectRateLimit(request, context);
  if (rateLimited) return rateLimited;

  const sessionResult = await verifySession(request, context);
  if ("response" in sessionResult) return sessionResult.response;
  const { user } = sessionResult;

  await context.moderation.ready;

  const denied = checkModerationStatus(context.moderation, user, context.log);
  if (denied) return denied;

  const connectionLimited = checkConnectionLimits(context.state, context.config, user, context.log);
  if (connectionLimited) return connectionLimited;

  return acceptWebSocket(user, context);
}
