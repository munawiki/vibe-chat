import {
  ClientEventSchema,
  PROTOCOL_VERSION,
  ServerEventSchema,
  type AuthUser,
  type GithubUserId,
  type ServerEvent,
} from "@vscode-chat/protocol";
import type { ChatRoomGuardrails } from "../config.js";
import { WS_MAX_CONSECUTIVE_INVALID_PAYLOADS, WS_MAX_INBOUND_MESSAGE_BYTES } from "./constants.js";
import { tryGetSocketUser } from "../socketAttachment.js";
import { ChatRoomHistory } from "./history.js";
import { ChatRoomModeration } from "./moderation.js";
import { ChatRoomRateLimits } from "./rateLimits.js";
import { createClientEventDispatcher, type ClientEvent } from "./chatRoom/dispatcher.js";
import { ChatRoomDmService } from "./chatRoom/dm.js";
import { handleChatRoomFetchWebSocketHandshake } from "./chatRoom/handshake.js";
import { ChatRoomPresence } from "./chatRoom/presence.js";
import { ChatRoomSession } from "./chatRoom/session.js";
import type { ChatRoomDeps, SendErrorArgs } from "./chatRoom/types.js";
import { log as structuredLog } from "../util/structuredLog.js";

export class ChatRoom implements DurableObject {
  private readonly config: ChatRoomGuardrails;

  private readonly history: ChatRoomHistory;
  private readonly rateLimits: ChatRoomRateLimits;
  private readonly moderation: ChatRoomModeration;
  private readonly presence: ChatRoomPresence;
  private readonly dm: ChatRoomDmService;
  private readonly dispatchClientEvent: (
    ws: WebSocket,
    user: AuthUser,
    event: ClientEvent,
  ) => Promise<void>;

  private readonly moderatorGithubUserIds: ReadonlySet<GithubUserId>;
  private readonly session: ChatRoomSession;
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
    this.session = new ChatRoomSession(
      {
        log: (event) => this.log(event),
        sendError: (ws, err) => this.sendError(ws, err),
      },
      this.env,
    );
    const configParsed = this.session.parseConfigOrThrow("chat_room");

    this.config = configParsed.guardrails;
    this.moderatorGithubUserIds = configParsed.moderatorGithubUserIds;

    this.history = new ChatRoomHistory(this.state, this.config);
    const deps: ChatRoomDeps = {
      state: this.state,
      getWebSockets: () => this.state.getWebSockets(),
      sendEvent: (ws, event) => this.sendEvent(ws, event),
      sendError: (ws, err) => this.sendError(ws, err),
      log: (event) => this.log(event),
    };
    this.rateLimits = new ChatRoomRateLimits({ config: this.config, deps });
    this.moderation = new ChatRoomModeration({
      ...deps,
      operatorDeniedGithubUserIds: configParsed.operatorDeniedGithubUserIds,
    });
    this.presence = new ChatRoomPresence(deps, (event) => this.broadcast(event));

    this.dm = new ChatRoomDmService(this.state, this.env.DM_ROOM);

    this.dispatchClientEvent = createClientEventDispatcher({
      ...deps,
      history: this.history,
      rateLimits: this.rateLimits,
      moderation: this.moderation,
      dm: this.dm,
      broadcastToUsers: (githubUserIds, event) => this.broadcastToUsers(githubUserIds, event),
    });
  }

  async fetch(request: Request): Promise<Response> {
    return handleChatRoomFetchWebSocketHandshake(request, {
      state: this.state,
      env: this.env,
      config: this.config,
      session: this.session,
      moderatorGithubUserIds: this.moderatorGithubUserIds,
      history: this.history,
      rateLimits: this.rateLimits,
      moderation: this.moderation,
      presence: this.presence,
      sendEvent: (ws, event) => this.sendEvent(ws, event),
      log: (event) => this.log(event),
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = this.decodeInboundMessageText(ws, message);
    if (!text) return;

    const event = this.parseClientEventOrStrike(ws, text);
    if (!event) return;
    this.invalidPayloadStrikes.delete(ws);

    const user = this.getSocketUserOrClose(ws);
    if (!user) return;

    await this.dispatchClientEvent(ws, user, event);
  }

  private decodeInboundMessageText(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): string | undefined {
    // Best-effort: bound inbound message size before attempting JSON parsing.
    // For strings, treat the limit as a conservative upper bound in UTF-16 code units.
    if (typeof message === "string") {
      if (message.length > WS_MAX_INBOUND_MESSAGE_BYTES) {
        ws.close(1009, "message_too_big");
        return undefined;
      }
      return message;
    }

    if (message.byteLength > WS_MAX_INBOUND_MESSAGE_BYTES) {
      ws.close(1009, "message_too_big");
      return undefined;
    }

    return new TextDecoder().decode(message);
  }

  private parseClientEventOrStrike(ws: WebSocket, text: string): ClientEvent | undefined {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.handleInvalidPayload(ws, "Invalid JSON");
      return undefined;
    }

    const parsed = ClientEventSchema.safeParse(json);
    if (!parsed.success) {
      this.handleInvalidPayload(ws, "Invalid event schema");
      return undefined;
    }

    return parsed.data;
  }

  private getSocketUserOrClose(ws: WebSocket): AuthUser | undefined {
    return this.session.getSocketUserOrClose(ws);
  }

  webSocketClose(ws: WebSocket): void {
    // Best-effort: state.getWebSockets() excludes closed sockets eventually.
    // Exclude the socket explicitly to avoid transient over-counting.
    this.presence.request({ exclude: ws });
  }

  webSocketError(_ws: WebSocket): void {
    return;
  }

  private broadcast(event: ServerEvent): void {
    const json = JSON.stringify(event);
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(json);
      } catch {}
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
      } catch {}
    }
  }

  private sendEvent(ws: WebSocket, event: ServerEvent): void {
    const parsed = ServerEventSchema.safeParse(event);
    if (!parsed.success) return;

    try {
      ws.send(JSON.stringify(event));
    } catch {}
  }

  private sendError(ws: WebSocket, err: SendErrorArgs): void {
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
      } catch {}
    }
  }

  private log(event: Record<string, unknown>): void {
    structuredLog(event);
  }
}
