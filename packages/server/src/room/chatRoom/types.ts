import type { GithubUserId, ServerEvent } from "@vscode-chat/protocol";
import type { ChatRoomHistory } from "../history.js";
import type { ChatRoomModeration } from "../moderation.js";
import type { ChatRoomRateLimits } from "../rateLimits.js";
import type { ChatRoomDmService } from "./dm.js";

export type SendErrorArgs = Pick<
  Extract<ServerEvent, { type: "server/error" }>,
  "code" | "message" | "retryAfterMs" | "clientMessageId"
>;

export interface ChatRoomDeps {
  readonly state: DurableObjectState;
  getWebSockets(): WebSocket[];
  sendEvent(ws: WebSocket, event: ServerEvent): void;
  sendError(ws: WebSocket, err: SendErrorArgs): void;
  log(event: Record<string, unknown>): void;
}

export interface DispatchContext extends ChatRoomDeps {
  readonly history: ChatRoomHistory;
  readonly rateLimits: ChatRoomRateLimits;
  readonly moderation: ChatRoomModeration;
  readonly dm: ChatRoomDmService;
  broadcastToUsers(githubUserIds: ReadonlySet<GithubUserId>, event: ServerEvent): void;
}
