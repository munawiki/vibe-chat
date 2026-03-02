import type {
  ExtModerationActionMsg,
  ExtModerationSnapshotMsg,
  ExtModerationUserAllowedMsg,
  ExtModerationUserDeniedMsg,
} from "../../src/contract/protocol/index.js";
import type { WebviewContext } from "../app/types.js";

function isSameGithubUserId(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

function isDeniedBySet(userId: string | null, set: ReadonlySet<string>): boolean {
  return userId !== null && set.has(userId);
}

export function canModerateProfile(options: {
  signedInIsModerator: boolean;
  activeProfileGithubUserId: string | null;
  isOwnProfile: boolean;
  isOperatorDenied: boolean;
}): boolean {
  if (!options.signedInIsModerator) return false;
  if (options.activeProfileGithubUserId === null) return false;
  if (options.isOwnProfile) return false;
  if (options.isOperatorDenied) return false;
  return true;
}

export function moderationStatusText(options: {
  action: ExtModerationActionMsg | null;
  shouldShowModeratorStatus: boolean;
  isOperatorDenied: boolean;
  isRoomDenied: boolean;
}): string {
  const actionText = moderationStatusFromAction(options.action);
  if (actionText !== undefined) return actionText;
  if (!options.shouldShowModeratorStatus) return "";
  return moderationStatusFromFlags(options);
}

function moderationStatusFromAction(action: ExtModerationActionMsg | null): string | undefined {
  if (!action) return undefined;
  if (action.phase === "error") return action.message ?? "Moderation action failed.";
  return MODERATION_STATUS_BY_PHASE_ACTION[`${action.phase}:${action.action}`];
}

function moderationStatusFromFlags(options: {
  isOperatorDenied: boolean;
  isRoomDenied: boolean;
}): string {
  if (options.isOperatorDenied) return "Blocked by operator policy.";
  if (options.isRoomDenied) return "Banned from this room.";
  return "";
}

const MODERATION_STATUS_BY_PHASE_ACTION: Readonly<
  Record<"pending:deny" | "pending:allow" | "success:deny" | "success:allow", string>
> = {
  "pending:deny": "Banning...",
  "pending:allow": "Unbanning...",
  "success:deny": "Banned.",
  "success:allow": "Unbanned.",
};

export function setProfileModStatus(ctx: WebviewContext, text: string): void {
  const el = ctx.els.profileModStatus;
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function canMessageInProfileContext(options: {
  isConnected: boolean;
  activeProfileGithubUserId: string | null;
  isOwnProfile: boolean;
}): boolean {
  if (!options.isConnected) return false;
  if (options.activeProfileGithubUserId === null) return false;
  if (options.isOwnProfile) return false;
  return true;
}

function updateModerationActionButtons(
  ctx: WebviewContext,
  options: { canModerate: boolean; isRoomDenied: boolean },
): void {
  if (ctx.els.profileActions) ctx.els.profileActions.hidden = !options.canModerate;
  if (ctx.els.profileBan) ctx.els.profileBan.hidden = !options.canModerate || options.isRoomDenied;
  if (ctx.els.profileUnban)
    ctx.els.profileUnban.hidden = !options.canModerate || !options.isRoomDenied;
}

function updateProfilePrimaryActionButtons(
  ctx: WebviewContext,
  options: {
    activeProfileGithubUserId: string | null;
    isOwnProfile: boolean;
  },
): void {
  const canMessage = canMessageInProfileContext({
    isConnected: ctx.state.auth.isConnected,
    activeProfileGithubUserId: options.activeProfileGithubUserId,
    isOwnProfile: options.isOwnProfile,
  });
  if (ctx.els.profileMessage) {
    ctx.els.profileMessage.hidden = !canMessage;
    ctx.els.profileMessage.disabled = !canMessage;
  }

  const canSignOut = ctx.state.auth.signedInGithubUserId !== null && options.isOwnProfile;
  if (ctx.els.profileSignOut) {
    ctx.els.profileSignOut.hidden = !canSignOut;
    ctx.els.profileSignOut.disabled = !canSignOut;
  }
}

export function renderProfileModerationControls(ctx: WebviewContext): void {
  const activeProfileGithubUserId = ctx.state.overlay.activeProfileGithubUserId;

  const isOwnProfile = isSameGithubUserId(
    activeProfileGithubUserId,
    ctx.state.auth.signedInGithubUserId,
  );
  const isOperatorDenied = isDeniedBySet(
    activeProfileGithubUserId,
    ctx.state.moderation.operatorDeniedGithubUserIds,
  );
  const isRoomDenied = isDeniedBySet(
    activeProfileGithubUserId,
    ctx.state.moderation.roomDeniedGithubUserIds,
  );

  const canModerate = canModerateProfile({
    signedInIsModerator: ctx.state.auth.signedInIsModerator,
    activeProfileGithubUserId,
    isOwnProfile,
    isOperatorDenied,
  });
  const shouldShowModeratorStatus =
    ctx.state.auth.signedInIsModerator && activeProfileGithubUserId !== null && !isOwnProfile;

  updateModerationActionButtons(ctx, { canModerate, isRoomDenied });
  updateProfilePrimaryActionButtons(ctx, { activeProfileGithubUserId, isOwnProfile });

  const statusText = moderationStatusText({
    action: ctx.state.moderation.moderationAction,
    shouldShowModeratorStatus,
    isOperatorDenied,
    isRoomDenied,
  });

  setProfileModStatus(ctx, statusText);
}

export function handleExtModerationSnapshot(
  ctx: WebviewContext,
  msg: ExtModerationSnapshotMsg,
): void {
  ctx.state.moderation.operatorDeniedGithubUserIds = new Set(msg.operatorDeniedGithubUserIds);
  ctx.state.moderation.roomDeniedGithubUserIds = new Set(msg.roomDeniedGithubUserIds);
  renderProfileModerationControls(ctx);
}

export function handleExtModerationUserDenied(
  ctx: WebviewContext,
  msg: ExtModerationUserDeniedMsg,
): void {
  ctx.state.moderation.roomDeniedGithubUserIds.add(msg.targetGithubUserId);
  renderProfileModerationControls(ctx);
}

export function handleExtModerationUserAllowed(
  ctx: WebviewContext,
  msg: ExtModerationUserAllowedMsg,
): void {
  ctx.state.moderation.roomDeniedGithubUserIds.delete(msg.targetGithubUserId);
  renderProfileModerationControls(ctx);
}

export function handleExtModerationAction(ctx: WebviewContext, msg: ExtModerationActionMsg): void {
  ctx.state.moderation.moderationAction = msg;
  renderProfileModerationControls(ctx);
}
