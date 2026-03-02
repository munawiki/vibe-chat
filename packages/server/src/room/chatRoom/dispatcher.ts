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
import {
  createCorrelatedServerMessageNewEvents,
  pickCorrelatedServerMessageNewEvent,
} from "../messageCorrelation.js";
import type { DispatchContext } from "./types.js";
export type { DispatchContext } from "./types.js";

export type ClientEvent = z.infer<typeof ClientEventSchema>;

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
  context: Pick<
    DispatchContext,
    "state" | "history" | "rateLimits" | "log" | "sendEvent" | "sendError"
  >,
): Promise<void> {
  const rateCheck = context.rateLimits.checkMessageRateLimit(user.githubUserId);
  if (!rateCheck.allowed) {
    context.log({ type: "chat_rate_limited", retryAfterMs: rateCheck.retryAfterMs });
    context.sendError(ws, {
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

  await context.history.append(newMessage);
  const events = createCorrelatedServerMessageNewEvents({
    message: newMessage,
    ...(event.clientMessageId ? { clientMessageId: event.clientMessageId } : {}),
  });
  for (const socket of context.state.getWebSockets()) {
    const socketUser = tryGetSocketUser(socket);
    const correlated = pickCorrelatedServerMessageNewEvent({
      recipientGithubUserId: socketUser?.githubUserId,
      senderGithubUserId: user.githubUserId,
      events,
    });
    context.sendEvent(socket, correlated);
  }
}

async function handleClientDmIdentityPublish(
  githubUserId: GithubUserId,
  event: Extract<ClientEvent, { type: "client/dm.identity.publish" }>,
  context: Pick<DispatchContext, "dm">,
): Promise<void> {
  await context.dm.ensureIdentitiesLoaded();
  await context.dm.storeIdentity(githubUserId, event.identity);
}

async function handleClientDmOpen(
  ws: WebSocket,
  githubUserId: GithubUserId,
  event: Extract<ClientEvent, { type: "client/dm.open" }>,
  context: Pick<DispatchContext, "dm" | "sendEvent" | "sendError">,
): Promise<void> {
  await context.dm.ensureIdentitiesLoaded();
  if (event.targetGithubUserId === githubUserId) {
    context.sendError(ws, { code: "invalid_payload", message: "Cannot DM self" });
    return;
  }

  const dmId = dmIdFromParticipants(githubUserId, event.targetGithubUserId);
  const history = await context.dm.readHistory(dmId);
  const peerIdentity = context.dm.getIdentity(event.targetGithubUserId);

  context.sendEvent(ws, {
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
  context: Pick<DispatchContext, "dm" | "rateLimits" | "log" | "sendError" | "broadcastToUsers">,
): Promise<void> {
  const rateCheck = context.rateLimits.checkMessageRateLimit(user.githubUserId);
  if (!rateCheck.allowed) {
    context.log({ type: "dm_rate_limited", retryAfterMs: rateCheck.retryAfterMs });
    context.sendError(ws, {
      code: "rate_limited",
      message: "Too many messages",
      retryAfterMs: rateCheck.retryAfterMs,
    });
    return;
  }

  const peerResult = context.dm.getPeerGithubUserId(user.githubUserId, event.dmId);
  if (!peerResult.ok) {
    context.sendError(ws, {
      code: peerResult.error === "invalid_dm_id" ? "invalid_payload" : "forbidden",
      message: peerResult.error === "invalid_dm_id" ? "Invalid dmId" : "Not a DM participant",
    });
    return;
  }
  const peerGithubUserId = peerResult.peerGithubUserId;

  if (peerGithubUserId !== event.recipientGithubUserId) {
    context.sendError(ws, { code: "invalid_payload", message: "DM recipient mismatch" });
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

  await context.dm.appendHistory(event.dmId, newMessage);

  context.broadcastToUsers(new Set([user.githubUserId, peerGithubUserId]), {
    version: PROTOCOL_VERSION,
    type: "server/dm.message.new",
    message: newMessage,
  } satisfies ServerEvent);
}

export function createClientEventDispatcher(
  context: DispatchContext,
): (ws: WebSocket, user: AuthUser, event: ClientEvent) => Promise<void> {
  const handlers = {
    "client/hello": async () => {
      // No-op: the authenticated identity is already bound at the WebSocket upgrade boundary.
    },
    "client/message.send": async (ws, user, event) =>
      handleClientMessageSend(ws, user, event, context),
    "client/dm.identity.publish": async (_ws, user, event) =>
      handleClientDmIdentityPublish(user.githubUserId, event, context),
    "client/dm.open": async (ws, user, event) =>
      handleClientDmOpen(ws, user.githubUserId, event, context),
    "client/dm.message.send": async (ws, user, event) =>
      handleClientDmMessageSend(ws, user, event, context),
    "client/moderation.user.deny": async (ws, user, event) =>
      context.moderation.handleUserDeny(ws, user, event.targetGithubUserId),
    "client/moderation.user.allow": async (ws, user, event) =>
      context.moderation.handleUserAllow(ws, user, event.targetGithubUserId),
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
