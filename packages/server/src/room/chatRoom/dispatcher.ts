import { z } from "zod";
import {
  ClientEventSchema,
  PROTOCOL_VERSION,
  dmIdFromParticipants,
  type AuthUser,
  type ChatMessagePlain,
  type DmMessageCipher,
  type GithubUserId,
  type ServerEvent,
} from "@vscode-chat/protocol";
import { createChatMessagePlain } from "../../policy/chatRoomPolicy.js";
import { tryGetSocketUser } from "../../socketAttachment.js";
import type { ChatRoomHistory } from "../history.js";
import {
  createCorrelatedServerMessageNewEvents,
  pickCorrelatedServerMessageNewEvent,
} from "../messageCorrelation.js";
import type { ChatRoomModeration } from "../moderation.js";
import type { ChatRoomRateLimits } from "../rateLimits.js";
import { ChatRoomDmService } from "./dm.js";

export type ClientEvent = z.infer<typeof ClientEventSchema>;

type SendErrorArgs = Pick<
  Extract<ServerEvent, { type: "server/error" }>,
  "code" | "message" | "retryAfterMs" | "clientMessageId"
>;

type HandlerMap = {
  [T in ClientEvent["type"]]: (
    ws: WebSocket,
    user: AuthUser,
    event: Extract<ClientEvent, { type: T }>,
  ) => void | Promise<void>;
};

async function handleClientMessageSend(
  ws: WebSocket,
  user: AuthUser,
  event: Extract<ClientEvent, { type: "client/message.send" }>,
  options: {
    state: DurableObjectState;
    history: ChatRoomHistory;
    rateLimits: ChatRoomRateLimits;
    log: (event: Record<string, unknown>) => void;
    sendEvent: (ws: WebSocket, event: ServerEvent) => void;
    sendError: (ws: WebSocket, err: SendErrorArgs) => void;
  },
): Promise<void> {
  const rateCheck = options.rateLimits.checkMessageRateLimit(user.githubUserId);
  if (!rateCheck.allowed) {
    options.log({ type: "chat_rate_limited", retryAfterMs: rateCheck.retryAfterMs });
    options.sendError(ws, {
      code: "rate_limited",
      message: "Too many messages",
      retryAfterMs: rateCheck.retryAfterMs,
      ...(event.clientMessageId ? { clientMessageId: event.clientMessageId } : {}),
    });
    return;
  }

  const newMessage: ChatMessagePlain = createChatMessagePlain({
    id: crypto.randomUUID(),
    user,
    text: event.text,
    createdAt: new Date().toISOString(),
  });

  await options.history.append(newMessage);
  const events = createCorrelatedServerMessageNewEvents({
    message: newMessage,
    ...(event.clientMessageId ? { clientMessageId: event.clientMessageId } : {}),
  });
  for (const socket of options.state.getWebSockets()) {
    const socketUser = tryGetSocketUser(socket);
    const correlated = pickCorrelatedServerMessageNewEvent({
      recipientGithubUserId: socketUser?.githubUserId,
      senderGithubUserId: user.githubUserId,
      events,
    });
    options.sendEvent(socket, correlated);
  }
}

async function handleClientDmIdentityPublish(
  githubUserId: GithubUserId,
  event: Extract<ClientEvent, { type: "client/dm.identity.publish" }>,
  options: { dm: ChatRoomDmService },
): Promise<void> {
  await options.dm.ensureIdentitiesLoaded();
  await options.dm.storeIdentity(githubUserId, event.identity);
}

async function handleClientDmOpen(
  ws: WebSocket,
  githubUserId: GithubUserId,
  event: Extract<ClientEvent, { type: "client/dm.open" }>,
  options: {
    dm: ChatRoomDmService;
    sendEvent: (ws: WebSocket, event: ServerEvent) => void;
    sendError: (ws: WebSocket, err: SendErrorArgs) => void;
  },
): Promise<void> {
  await options.dm.ensureIdentitiesLoaded();
  if (event.targetGithubUserId === githubUserId) {
    options.sendError(ws, { code: "invalid_payload", message: "Cannot DM self" });
    return;
  }

  const dmId = dmIdFromParticipants(githubUserId, event.targetGithubUserId);
  const history = await options.dm.readHistory(dmId);
  const peerIdentity = options.dm.getIdentity(event.targetGithubUserId);

  options.sendEvent(ws, {
    version: PROTOCOL_VERSION,
    type: "server/dm.welcome",
    dmId,
    peerGithubUserId: event.targetGithubUserId,
    ...(peerIdentity ? { peerIdentity } : {}),
    history,
  } satisfies ServerEvent);
}

async function handleClientDmMessageSend(
  ws: WebSocket,
  user: AuthUser,
  event: Extract<ClientEvent, { type: "client/dm.message.send" }>,
  options: {
    dm: ChatRoomDmService;
    rateLimits: ChatRoomRateLimits;
    log: (event: Record<string, unknown>) => void;
    sendError: (ws: WebSocket, err: SendErrorArgs) => void;
    broadcastToUsers: (githubUserIds: ReadonlySet<GithubUserId>, event: ServerEvent) => void;
  },
): Promise<void> {
  const rateCheck = options.rateLimits.checkMessageRateLimit(user.githubUserId);
  if (!rateCheck.allowed) {
    options.log({ type: "dm_rate_limited", retryAfterMs: rateCheck.retryAfterMs });
    options.sendError(ws, {
      code: "rate_limited",
      message: "Too many messages",
      retryAfterMs: rateCheck.retryAfterMs,
    });
    return;
  }

  const peerResult = options.dm.getPeerGithubUserId(user.githubUserId, event.dmId);
  if (!peerResult.ok) {
    options.sendError(ws, {
      code: peerResult.error === "invalid_dm_id" ? "invalid_payload" : "forbidden",
      message: peerResult.error === "invalid_dm_id" ? "Invalid dmId" : "Not a DM participant",
    });
    return;
  }
  const peerGithubUserId = peerResult.peerGithubUserId;

  if (peerGithubUserId !== event.recipientGithubUserId) {
    options.sendError(ws, { code: "invalid_payload", message: "DM recipient mismatch" });
    return;
  }

  const now = new Date().toISOString();
  const newMessage: DmMessageCipher = {
    id: crypto.randomUUID(),
    dmId: event.dmId,
    sender: user,
    recipientGithubUserId: peerGithubUserId,
    senderIdentity: event.senderIdentity,
    recipientIdentity: event.recipientIdentity,
    nonce: event.nonce,
    ciphertext: event.ciphertext,
    createdAt: now,
  };

  await options.dm.appendHistory(event.dmId, newMessage);

  options.broadcastToUsers(new Set([user.githubUserId, peerGithubUserId]), {
    version: PROTOCOL_VERSION,
    type: "server/dm.message.new",
    message: newMessage,
  } satisfies ServerEvent);
}

export function createClientEventDispatcher(options: {
  state: DurableObjectState;
  history: ChatRoomHistory;
  rateLimits: ChatRoomRateLimits;
  moderation: ChatRoomModeration;
  dm: ChatRoomDmService;
  log: (event: Record<string, unknown>) => void;
  sendEvent: (ws: WebSocket, event: ServerEvent) => void;
  sendError: (ws: WebSocket, err: SendErrorArgs) => void;
  broadcastToUsers: (githubUserIds: ReadonlySet<GithubUserId>, event: ServerEvent) => void;
}): (ws: WebSocket, user: AuthUser, event: ClientEvent) => Promise<void> {
  const handlers = {
    "client/hello": async () => {
      // No-op: the authenticated identity is already bound at the WebSocket upgrade boundary.
    },
    "client/message.send": async (ws, user, event) =>
      handleClientMessageSend(ws, user, event, {
        state: options.state,
        history: options.history,
        rateLimits: options.rateLimits,
        log: options.log,
        sendEvent: options.sendEvent,
        sendError: options.sendError,
      }),
    "client/dm.identity.publish": async (_ws, user, event) =>
      handleClientDmIdentityPublish(user.githubUserId, event, { dm: options.dm }),
    "client/dm.open": async (ws, user, event) =>
      handleClientDmOpen(ws, user.githubUserId, event, {
        dm: options.dm,
        sendEvent: options.sendEvent,
        sendError: options.sendError,
      }),
    "client/dm.message.send": async (ws, user, event) =>
      handleClientDmMessageSend(ws, user, event, {
        dm: options.dm,
        rateLimits: options.rateLimits,
        log: options.log,
        sendError: options.sendError,
        broadcastToUsers: options.broadcastToUsers,
      }),
    "client/moderation.user.deny": async (ws, user, event) =>
      options.moderation.handleUserDeny(ws, user, event.targetGithubUserId),
    "client/moderation.user.allow": async (ws, user, event) =>
      options.moderation.handleUserAllow(ws, user, event.targetGithubUserId),
  } satisfies HandlerMap;

  return async (ws: WebSocket, user: AuthUser, event: ClientEvent): Promise<void> => {
    const handler = handlers[event.type] as (
      ws: WebSocket,
      user: AuthUser,
      event: ClientEvent,
    ) => Promise<void>;
    await handler(ws, user, event);
  };
}
