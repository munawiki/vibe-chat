import type { GithubUserId, ServerEvent } from "@vscode-chat/protocol";
import type { ChatClientState } from "../../net/chatClient.js";
import type {
  ExtModerationActionMsg,
  ExtModerationSnapshotMsg,
  ExtModerationUserAllowedMsg,
  ExtModerationUserDeniedMsg,
} from "../../contract/protocol/index.js";
import {
  MODERATION_HANDLERS,
  isModeratorActionConfirmedByActor,
  isPendingMatch,
  type ModerationAction,
  type PendingModeration,
} from "./moderationHandlers.js";

export type ModerationSnapshot = {
  operatorDeniedGithubUserIds: GithubUserId[];
  roomDeniedGithubUserIds: GithubUserId[];
};

export type ModerationSendCommand = {
  action: ModerationAction;
  targetGithubUserId: GithubUserId;
};

export class ChatViewModeration {
  private snapshot: ModerationSnapshot | undefined;
  private pending: PendingModeration | undefined;

  reset(): void {
    this.snapshot = undefined;
    this.pending = undefined;
  }

  getSnapshotMessage(): ExtModerationSnapshotMsg | undefined {
    if (!this.snapshot) return undefined;
    return {
      type: "ext/moderation.snapshot",
      operatorDeniedGithubUserIds: this.snapshot.operatorDeniedGithubUserIds,
      roomDeniedGithubUserIds: this.snapshot.roomDeniedGithubUserIds,
    };
  }

  handleUiAction(
    action: ModerationAction,
    targetGithubUserId: GithubUserId,
    clientState: ChatClientState,
  ): { outbound: ExtModerationActionMsg; send?: ModerationSendCommand } {
    const handler = MODERATION_HANDLERS[action];
    if (clientState.authStatus !== "signedIn" || clientState.status !== "connected") {
      return {
        outbound: {
          type: "ext/moderation.action",
          action,
          targetGithubUserId,
          phase: "error",
          message: "Not connected.",
        },
      };
    }

    if (!clientState.user.roles.includes("moderator")) {
      return {
        outbound: {
          type: "ext/moderation.action",
          action,
          targetGithubUserId,
          phase: "error",
          message: "Moderator role required.",
        },
      };
    }

    if (clientState.user.githubUserId === targetGithubUserId) {
      return {
        outbound: {
          type: "ext/moderation.action",
          action,
          targetGithubUserId,
          phase: "error",
          message: handler.selfActionMessage,
        },
      };
    }

    this.pending = { action, targetGithubUserId };
    return {
      outbound: { type: "ext/moderation.action", action, targetGithubUserId, phase: "pending" },
      send: { action, targetGithubUserId },
    };
  }

  handleServerError(
    event: Extract<ServerEvent, { type: "server/error" }>,
  ): ExtModerationActionMsg | undefined {
    if (!this.pending) return undefined;
    const pending = this.pending;
    this.pending = undefined;

    return {
      type: "ext/moderation.action",
      action: pending.action,
      targetGithubUserId: pending.targetGithubUserId,
      phase: "error",
      message: event.message ?? event.code,
    };
  }

  handleServerSnapshot(
    event: Extract<ServerEvent, { type: "server/moderation.snapshot" }>,
  ): ExtModerationSnapshotMsg {
    this.snapshot = {
      operatorDeniedGithubUserIds: event.operatorDeniedGithubUserIds,
      roomDeniedGithubUserIds: event.roomDeniedGithubUserIds,
    };
    return {
      type: "ext/moderation.snapshot",
      operatorDeniedGithubUserIds: event.operatorDeniedGithubUserIds,
      roomDeniedGithubUserIds: event.roomDeniedGithubUserIds,
    };
  }

  handleServerUserDenied(
    event: Extract<ServerEvent, { type: "server/moderation.user.denied" }>,
    clientState: ChatClientState,
  ): { userMessage: ExtModerationUserDeniedMsg; resolved?: ExtModerationActionMsg } {
    this.snapshot = this.nextSnapshotAfterDenied(event.targetGithubUserId);
    const resolved = this.maybeResolvePendingModeration({
      action: "deny",
      actorGithubUserId: event.actorGithubUserId,
      targetGithubUserId: event.targetGithubUserId,
      clientState,
    });
    if (resolved) {
      return {
        userMessage: {
          type: "ext/moderation.user.denied",
          actorGithubUserId: event.actorGithubUserId,
          targetGithubUserId: event.targetGithubUserId,
        },
        resolved,
      };
    }
    return {
      userMessage: {
        type: "ext/moderation.user.denied",
        actorGithubUserId: event.actorGithubUserId,
        targetGithubUserId: event.targetGithubUserId,
      },
    };
  }

  handleServerUserAllowed(
    event: Extract<ServerEvent, { type: "server/moderation.user.allowed" }>,
    clientState: ChatClientState,
  ): { userMessage: ExtModerationUserAllowedMsg; resolved?: ExtModerationActionMsg } {
    if (this.snapshot) {
      this.snapshot = {
        ...this.snapshot,
        roomDeniedGithubUserIds: this.snapshot.roomDeniedGithubUserIds.filter(
          (id) => id !== event.targetGithubUserId,
        ),
      };
    }
    const resolved = this.maybeResolvePendingModeration({
      action: "allow",
      actorGithubUserId: event.actorGithubUserId,
      targetGithubUserId: event.targetGithubUserId,
      clientState,
    });
    if (resolved) {
      return {
        userMessage: {
          type: "ext/moderation.user.allowed",
          actorGithubUserId: event.actorGithubUserId,
          targetGithubUserId: event.targetGithubUserId,
        },
        resolved,
      };
    }
    return {
      userMessage: {
        type: "ext/moderation.user.allowed",
        actorGithubUserId: event.actorGithubUserId,
        targetGithubUserId: event.targetGithubUserId,
      },
    };
  }

  private nextSnapshotAfterDenied(targetGithubUserId: GithubUserId): ModerationSnapshot {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return { operatorDeniedGithubUserIds: [], roomDeniedGithubUserIds: [targetGithubUserId] };
    }
    if (snapshot.roomDeniedGithubUserIds.includes(targetGithubUserId)) return snapshot;
    return {
      ...snapshot,
      roomDeniedGithubUserIds: [...snapshot.roomDeniedGithubUserIds, targetGithubUserId],
    };
  }

  private maybeResolvePendingModeration(options: {
    action: ModerationAction;
    actorGithubUserId: GithubUserId;
    targetGithubUserId: GithubUserId;
    clientState: ChatClientState;
  }): ExtModerationActionMsg | undefined {
    const pending = this.pending;
    if (!isPendingMatch(pending, options)) return undefined;
    if (!isModeratorActionConfirmedByActor(options.clientState, options.actorGithubUserId)) {
      return undefined;
    }

    this.pending = undefined;
    return {
      type: "ext/moderation.action",
      action: pending.action,
      targetGithubUserId: pending.targetGithubUserId,
      phase: "success",
      message: MODERATION_HANDLERS[pending.action].successMessage,
    };
  }
}
