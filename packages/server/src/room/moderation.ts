import {
  GithubUserIdSchema,
  PROTOCOL_VERSION,
  type AuthUser,
  type GithubUserId,
  type ServerEvent,
} from "@vscode-chat/protocol";
import { ROOM_DENYLIST_KEY } from "./constants.js";
import { tryGetSocketUser } from "../socketAttachment.js";

type SendError = (
  ws: WebSocket,
  err: Pick<Extract<ServerEvent, { type: "server/error" }>, "code" | "message" | "retryAfterMs">,
) => void;

function compareGithubUserIds(a: GithubUserId, b: GithubUserId): number {
  if (a === b) return 0;
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : 1;
}

export class ChatRoomModeration {
  private readyPromise: Promise<void> | undefined;

  private readonly roomDeniedGithubUserIds = new Set<GithubUserId>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly operatorDeniedGithubUserIds: ReadonlySet<GithubUserId>,
    private readonly getWebSockets: () => WebSocket[],
    private readonly sendEvent: (ws: WebSocket, event: ServerEvent) => void,
    private readonly sendError: SendError,
    private readonly log: (event: Record<string, unknown>) => void,
  ) {}

  get ready(): Promise<void> {
    this.readyPromise ??= this.loadRoomDenylist();
    return this.readyPromise;
  }

  isDeniedGithubUserId(githubUserId: GithubUserId): boolean {
    return (
      this.operatorDeniedGithubUserIds.has(githubUserId) ||
      this.roomDeniedGithubUserIds.has(githubUserId)
    );
  }

  isModerator(user: AuthUser): boolean {
    return user.roles.includes("moderator");
  }

  sendSnapshot(ws: WebSocket): void {
    this.sendEvent(ws, {
      version: PROTOCOL_VERSION,
      type: "server/moderation.snapshot",
      operatorDeniedGithubUserIds: [...this.operatorDeniedGithubUserIds].sort(compareGithubUserIds),
      roomDeniedGithubUserIds: [...this.roomDeniedGithubUserIds].sort(compareGithubUserIds),
    } satisfies ServerEvent);
  }

  async handleUserDeny(
    ws: WebSocket,
    actor: AuthUser,
    targetGithubUserId: GithubUserId,
  ): Promise<void> {
    if (!this.guardModeratorAction(ws, actor, targetGithubUserId, "Self-ban is not allowed.")) {
      return;
    }

    await this.ready;

    const wasDenied = this.isDeniedGithubUserId(targetGithubUserId);
    if (!wasDenied) {
      this.roomDeniedGithubUserIds.add(targetGithubUserId);
      await this.persistRoomDenylist();
    }

    this.kickUser(targetGithubUserId);

    this.log({
      type: "moderation_user_denied",
      actorGithubUserId: actor.githubUserId,
      targetGithubUserId,
    });
    this.sendToModerators({
      version: PROTOCOL_VERSION,
      type: "server/moderation.user.denied",
      actorGithubUserId: actor.githubUserId,
      targetGithubUserId,
    } satisfies ServerEvent);
  }

  async handleUserAllow(
    ws: WebSocket,
    actor: AuthUser,
    targetGithubUserId: GithubUserId,
  ): Promise<void> {
    if (
      !this.guardModeratorAction(ws, actor, targetGithubUserId, "Self-unban is not applicable.")
    ) {
      return;
    }

    await this.ready;

    if (this.operatorDeniedGithubUserIds.has(targetGithubUserId)) {
      this.sendError(ws, {
        code: "forbidden",
        message: "Operator deny cannot be overridden by moderator unban.",
      });
      return;
    }

    const deleted = this.roomDeniedGithubUserIds.delete(targetGithubUserId);
    if (deleted) {
      await this.persistRoomDenylist();
    }

    this.log({
      type: "moderation_user_allowed",
      actorGithubUserId: actor.githubUserId,
      targetGithubUserId,
    });
    this.sendToModerators({
      version: PROTOCOL_VERSION,
      type: "server/moderation.user.allowed",
      actorGithubUserId: actor.githubUserId,
      targetGithubUserId,
    } satisfies ServerEvent);
  }

  private guardModeratorAction(
    ws: WebSocket,
    actor: AuthUser,
    targetGithubUserId: GithubUserId,
    selfActionMessage: string,
  ): boolean {
    if (!this.isModerator(actor)) {
      this.sendError(ws, { code: "forbidden", message: "Moderator role required." });
      return false;
    }

    if (actor.githubUserId === targetGithubUserId) {
      this.sendError(ws, { code: "forbidden", message: selfActionMessage });
      return false;
    }

    return true;
  }

  private async loadRoomDenylist(): Promise<void> {
    const saved = await this.state.storage.get<unknown>(ROOM_DENYLIST_KEY);
    if (!Array.isArray(saved)) return;

    for (const item of saved) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (trimmed.length === 0) continue;
      const parsed = GithubUserIdSchema.safeParse(trimmed);
      if (!parsed.success) continue;
      this.roomDeniedGithubUserIds.add(parsed.data);
    }
  }

  private async persistRoomDenylist(): Promise<void> {
    await this.state.storage.put(
      ROOM_DENYLIST_KEY,
      [...this.roomDeniedGithubUserIds].sort(compareGithubUserIds),
    );
  }

  private kickUser(targetGithubUserId: GithubUserId): void {
    for (const socket of this.getWebSockets()) {
      const user = tryGetSocketUser(socket);
      if (!user) continue;
      if (user.githubUserId !== targetGithubUserId) continue;

      this.sendError(socket, {
        code: "forbidden",
        message: "You have been banned from the room.",
      });
      socket.close(1008, "banned");
    }
  }

  private sendToModerators(event: ServerEvent): void {
    const json = JSON.stringify(event);
    for (const socket of this.getWebSockets()) {
      const user = tryGetSocketUser(socket);
      if (!user || !this.isModerator(user)) continue;

      try {
        socket.send(json);
      } catch {
        // ignore
      }
    }
  }
}
