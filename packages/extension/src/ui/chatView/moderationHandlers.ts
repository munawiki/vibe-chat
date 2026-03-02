import type { GithubUserId } from "@vscode-chat/protocol";
import type { ChatClientState } from "../../net/chatClient.js";

export type ModerationAction = "deny" | "allow";

export type PendingModeration = {
  action: ModerationAction;
  targetGithubUserId: GithubUserId;
};

export const MODERATION_HANDLERS: Record<
  ModerationAction,
  {
    selfActionMessage: string;
    successMessage: string;
  }
> = {
  deny: {
    selfActionMessage: "Self-ban is not allowed.",
    successMessage: "User banned.",
  },
  allow: {
    selfActionMessage: "Self-unban is not applicable.",
    successMessage: "User unbanned.",
  },
};

export function isPendingMatch(
  pending: PendingModeration | undefined,
  options: { action: ModerationAction; targetGithubUserId: GithubUserId },
): pending is PendingModeration {
  return (
    !!pending &&
    pending.action === options.action &&
    pending.targetGithubUserId === options.targetGithubUserId
  );
}

export function isModeratorActionConfirmedByActor(
  state: ChatClientState,
  actorGithubUserId: GithubUserId,
): state is Extract<ChatClientState, { authStatus: "signedIn" }> {
  return (
    state.authStatus === "signedIn" &&
    "user" in state &&
    !!state.user &&
    state.user.githubUserId === actorGithubUserId
  );
}
