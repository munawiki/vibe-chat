import {
  PROTOCOL_VERSION,
  type AuthUser,
  type GithubUserId,
  type ServerEvent,
} from "@vscode-chat/protocol";
import { tryGetSocketUser } from "../socketAttachment.js";
import type { ChatRoomDeps } from "./chatRoom/types.js";
import { isDenied, isModerator, isOperatorDenied } from "./moderationGuard.js";
import { loadDenylist, saveDenylist } from "./moderationPersistence.js";

function compareGithubUserIds(a: GithubUserId, b: GithubUserId): number {
  if (a === b) return 0;
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : 1;
}

export class ChatRoomModeration {
  private readyPromise: Promise<void> | undefined;

  private readonly roomDeniedGithubUserIds = new Set<GithubUserId>();

  constructor(
    private readonly deps: ChatRoomDeps & {
      readonly operatorDeniedGithubUserIds: ReadonlySet<GithubUserId>;
    },
  ) {}

  get ready(): Promise<void> {
    this.readyPromise ??= this.initDenylist();
    return this.readyPromise;
  }

  isDeniedGithubUserId(githubUserId: GithubUserId): boolean {
    return isDenied({
      operatorDeniedGithubUserIds: this.deps.operatorDeniedGithubUserIds,
      roomDeniedGithubUserIds: this.roomDeniedGithubUserIds,
      githubUserId,
    });
  }

  isModerator(user: AuthUser): boolean {
    return isModerator(user);
  }

  sendSnapshot(ws: WebSocket): void {
    this.deps.sendEvent(ws, {
      version: PROTOCOL_VERSION,
      type: "server/moderation.snapshot",
      operatorDeniedGithubUserIds: [...this.deps.operatorDeniedGithubUserIds].sort(
        compareGithubUserIds,
      ),
      roomDeniedGithubUserIds: [...this.roomDeniedGithubUserIds].sort(compareGithubUserIds),
    } satisfies ServerEvent);
  }

  async handleUserDeny(
    ws: WebSocket,
    actor: AuthUser,
    targetGithubUserId: GithubUserId,
  ): Promise<void> {
    await this.handleModerationAction({
      action: "deny",
      ws,
      actor,
      targetGithubUserId,
      selfActionMessage: "Self-ban is not allowed.",
    });
  }

  async handleUserAllow(
    ws: WebSocket,
    actor: AuthUser,
    targetGithubUserId: GithubUserId,
  ): Promise<void> {
    await this.handleModerationAction({
      action: "allow",
      ws,
      actor,
      targetGithubUserId,
      selfActionMessage: "Self-unban is not applicable.",
    });
  }

  private async handleModerationAction(options: {
    action: "deny" | "allow";
    ws: WebSocket;
    actor: AuthUser;
    targetGithubUserId: GithubUserId;
    selfActionMessage: string;
  }): Promise<void> {
    if (
      !this.guardModeratorAction(
        options.ws,
        options.actor,
        options.targetGithubUserId,
        options.selfActionMessage,
      )
    ) {
      return;
    }

    await this.ready;

    if (options.action === "deny") {
      await this.denyUser(options.targetGithubUserId);
    } else {
      if (isOperatorDenied(this.deps.operatorDeniedGithubUserIds, options.targetGithubUserId)) {
        this.deps.sendError(options.ws, {
          code: "forbidden",
          message: "Operator deny cannot be overridden by moderator unban.",
        });
        return;
      }
      await this.allowUser(options.targetGithubUserId);
    }

    this.deps.log({
      type: options.action === "deny" ? "moderation_user_denied" : "moderation_user_allowed",
      actorGithubUserId: options.actor.githubUserId,
      targetGithubUserId: options.targetGithubUserId,
    });
    this.sendToModerators({
      version: PROTOCOL_VERSION,
      type:
        options.action === "deny"
          ? "server/moderation.user.denied"
          : "server/moderation.user.allowed",
      actorGithubUserId: options.actor.githubUserId,
      targetGithubUserId: options.targetGithubUserId,
    } satisfies ServerEvent);
  }

  private guardModeratorAction(
    ws: WebSocket,
    actor: AuthUser,
    targetGithubUserId: GithubUserId,
    selfActionMessage: string,
  ): boolean {
    if (!isModerator(actor)) {
      this.deps.sendError(ws, { code: "forbidden", message: "Moderator role required." });
      return false;
    }

    if (actor.githubUserId === targetGithubUserId) {
      this.deps.sendError(ws, { code: "forbidden", message: selfActionMessage });
      return false;
    }

    return true;
  }

  private async initDenylist(): Promise<void> {
    const loaded = await loadDenylist(this.deps.state);
    for (const githubUserId of loaded) {
      this.roomDeniedGithubUserIds.add(githubUserId);
    }
  }

  private async denyUser(targetGithubUserId: GithubUserId): Promise<void> {
    const wasDenied = this.isDeniedGithubUserId(targetGithubUserId);
    if (!wasDenied) {
      this.roomDeniedGithubUserIds.add(targetGithubUserId);
      await saveDenylist(this.deps.state, this.roomDeniedGithubUserIds);
    }
    this.kickUser(targetGithubUserId);
  }

  private async allowUser(targetGithubUserId: GithubUserId): Promise<void> {
    const deleted = this.roomDeniedGithubUserIds.delete(targetGithubUserId);
    if (deleted) {
      await saveDenylist(this.deps.state, this.roomDeniedGithubUserIds);
    }
  }

  private kickUser(targetGithubUserId: GithubUserId): void {
    for (const socket of this.deps.getWebSockets()) {
      const user = tryGetSocketUser(socket);
      if (!user) continue;
      if (user.githubUserId !== targetGithubUserId) continue;

      this.deps.sendError(socket, {
        code: "forbidden",
        message: "You have been banned from the room.",
      });
      socket.close(1008, "banned");
    }
  }

  private sendToModerators(event: ServerEvent): void {
    const json = JSON.stringify(event);
    for (const socket of this.deps.getWebSockets()) {
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
