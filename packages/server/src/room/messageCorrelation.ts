import {
  PROTOCOL_VERSION,
  type ChatMessagePlain,
  type GithubUserId,
  type ServerEvent,
} from "@vscode-chat/protocol";

type ServerMessageNewEvent = Extract<ServerEvent, { type: "server/message.new" }>;

export function createCorrelatedServerMessageNewEvents(options: {
  message: ChatMessagePlain;
  clientMessageId?: string;
}): { publicEvent: ServerMessageNewEvent; senderEvent: ServerMessageNewEvent } {
  const publicEvent: ServerMessageNewEvent = {
    version: PROTOCOL_VERSION,
    type: "server/message.new",
    message: options.message,
  };

  const senderEvent: ServerMessageNewEvent =
    typeof options.clientMessageId === "string"
      ? { ...publicEvent, clientMessageId: options.clientMessageId }
      : publicEvent;

  return { publicEvent, senderEvent };
}

export function pickCorrelatedServerMessageNewEvent(options: {
  recipientGithubUserId: GithubUserId | undefined;
  senderGithubUserId: GithubUserId;
  events: { publicEvent: ServerMessageNewEvent; senderEvent: ServerMessageNewEvent };
}): ServerMessageNewEvent {
  return options.recipientGithubUserId === options.senderGithubUserId
    ? options.events.senderEvent
    : options.events.publicEvent;
}
