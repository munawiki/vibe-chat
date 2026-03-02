import type { ServerEvent } from "@vscode-chat/protocol";
import type { ExtOutbound } from "../../contract/protocol/index.js";
import type { ChatClient } from "../../net/chatClient.js";
import type { ChatViewDirectMessages } from "../chatView/directMessages.js";
import type { ChatViewModeration } from "../chatView/moderation.js";
import type { ChatViewPresence } from "../chatView/presence.js";

type HandlerMap = Partial<{
  [T in ServerEvent["type"]]: (event: Extract<ServerEvent, { type: T }>) => void | Promise<void>;
}>;

function runHandlers(map: HandlerMap, event: ServerEvent): void | Promise<void> {
  const handler = map[event.type];
  if (!handler) return;
  return handler(event as never);
}

export function createServerEventRouter(options: {
  client: ChatClient;
  onNewMessage: () => void;
  postMessage: (message: ExtOutbound) => void;
  postError: (message: string) => void;
  postDirectMessagesResult: (
    outbound: ExtOutbound[],
    additional: ExtOutbound | undefined,
    error: string | undefined,
  ) => void;
  directMessages: ChatViewDirectMessages;
  presence: ChatViewPresence;
  moderation: ChatViewModeration;
}): (event: ServerEvent) => Promise<void> {
  const unreadHandlers = {
    "server/message.new": () => options.onNewMessage(),
  } satisfies HandlerMap;

  const globalChatHandlers = {
    "server/welcome": (event) => {
      options.postMessage({ type: "ext/history", history: event.history });
    },
    "server/message.new": (event) => {
      options.postMessage({
        type: "ext/message",
        message: event.message,
        ...(event.clientMessageId ? { clientMessageId: event.clientMessageId } : {}),
      });
    },
  } satisfies HandlerMap;

  const directMessagesHandlers = {
    "server/dm.welcome": async (event) => {
      const dmWelcomeEvent = {
        dmId: event.dmId,
        peerGithubUserId: event.peerGithubUserId,
        history: event.history,
        ...(event.peerIdentity ? { peerIdentity: event.peerIdentity } : {}),
      };
      const result = await options.directMessages.handleServerWelcome({
        event: dmWelcomeEvent,
        clientState: options.client.getState(),
      });
      options.postDirectMessagesResult(result.outbound, result.history, result.error);
    },
    "server/dm.message.new": async (event) => {
      const result = await options.directMessages.handleServerMessageNew({
        event: { message: event.message },
        clientState: options.client.getState(),
      });
      options.postDirectMessagesResult(result.outbound, result.message, result.error);
    },
  } satisfies HandlerMap;

  const presenceHandlers = {
    "server/presence": (event) => {
      const msg = options.presence.handleServerSnapshot(event.snapshot);
      options.postMessage(msg);
    },
  } satisfies HandlerMap;

  const moderationHandlers = {
    "server/moderation.snapshot": (event) => {
      const msg = options.moderation.handleServerSnapshot(event);
      options.postMessage(msg);
    },
    "server/moderation.user.denied": (event) => {
      const { userMessage, resolved } = options.moderation.handleServerUserDenied(
        event,
        options.client.getState(),
      );
      options.postMessage(userMessage);
      if (resolved) options.postMessage(resolved);
    },
    "server/moderation.user.allowed": (event) => {
      const { userMessage, resolved } = options.moderation.handleServerUserAllowed(
        event,
        options.client.getState(),
      );
      options.postMessage(userMessage);
      if (resolved) options.postMessage(resolved);
    },
  } satisfies HandlerMap;

  const errorHandlers = {
    "server/error": (event) => {
      if (event.clientMessageId) {
        options.postMessage({
          type: "ext/message.send.error",
          clientMessageId: event.clientMessageId,
          code: event.code,
          ...(event.message ? { message: event.message } : {}),
          ...(typeof event.retryAfterMs === "number" ? { retryAfterMs: event.retryAfterMs } : {}),
        });
        return;
      }

      const moderation = options.moderation.handleServerError(event);
      if (moderation) options.postMessage(moderation);
      options.postError(event.message ?? event.code);
    },
  } satisfies HandlerMap;

  return async (event: ServerEvent): Promise<void> => {
    await runHandlers(unreadHandlers, event);
    await runHandlers(globalChatHandlers, event);
    await runHandlers(directMessagesHandlers, event);
    await runHandlers(presenceHandlers, event);
    await runHandlers(moderationHandlers, event);
    await runHandlers(errorHandlers, event);
  };
}
