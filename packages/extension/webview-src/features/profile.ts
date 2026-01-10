import type {
  ExtModerationActionMsg,
  ExtModerationSnapshotMsg,
  ExtModerationUserAllowedMsg,
  ExtModerationUserDeniedMsg,
  ExtProfileErrorMsg,
  ExtProfileResultMsg,
  UiInbound,
} from "../../src/contract/webviewProtocol.js";
import type { WebviewContext } from "../app/types.js";
import { closeOverlay, openOverlay } from "./overlay.js";

function setProfileError(ctx: WebviewContext, text: string): void {
  const el = ctx.els.profileError;
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function setProfileModStatus(ctx: WebviewContext, text: string): void {
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

function setProfileAvatar(ctx: WebviewContext, login: string, avatarUrl: string | undefined): void {
  if (!ctx.els.profileAvatar) return;
  ctx.els.profileAvatar.alt = login;
  ctx.els.profileAvatar.src = avatarUrl ?? "";
}

function renderProfileLoading(
  ctx: WebviewContext,
  login: string,
  avatarUrl: string | undefined,
): void {
  setProfileError(ctx, "");
  setProfileModStatus(ctx, "");
  if (ctx.els.profileBody) {
    const text = document.createElement("div");
    text.className = "muted";
    text.textContent = "Loading...";
    ctx.els.profileBody.replaceChildren(text);
  }
  if (ctx.els.profileName) ctx.els.profileName.textContent = "";
  if (ctx.els.profileLogin) ctx.els.profileLogin.textContent = login;
  setProfileAvatar(ctx, login, avatarUrl);
}

function renderProfile(ctx: WebviewContext, profile: ExtProfileResultMsg["profile"]): void {
  ctx.state.activeProfileGithubUserId = profile.githubUserId;
  if (ctx.els.profileName) ctx.els.profileName.textContent = profile.name ?? "";
  if (ctx.els.profileLogin) ctx.els.profileLogin.textContent = profile.login;
  if (ctx.els.profileBody) {
    const fragment = document.createDocumentFragment();

    if (profile.bio) {
      const bio = document.createElement("div");
      bio.className = "profileBio";
      bio.textContent = profile.bio;
      fragment.appendChild(bio);
    }

    if (profile.company) {
      const company = document.createElement("div");
      company.className = "profileDetail";
      company.textContent = profile.company;
      fragment.appendChild(company);
    }

    if (profile.location) {
      const location = document.createElement("div");
      location.className = "profileDetail";
      location.textContent = profile.location;
      fragment.appendChild(location);
    }

    if (profile.blog) {
      const blog = document.createElement("div");
      blog.className = "profileDetail";
      blog.textContent = profile.blog;
      fragment.appendChild(blog);
    }

    ctx.els.profileBody.replaceChildren(fragment);
  }

  setProfileAvatar(ctx, profile.login, profile.avatarUrl);
  renderProfileModerationControls(ctx);
}

export function openProfile(
  ctx: WebviewContext,
  login: string,
  avatarUrl: string | undefined,
): void {
  ctx.state.activeProfileLogin = login;
  ctx.state.activeProfileKey = login.toLowerCase();
  ctx.state.activeProfileGithubUserId = null;
  ctx.state.moderationAction = null;
  renderProfileLoading(ctx, login, avatarUrl);
  openOverlay(ctx, "profile");
  ctx.vscode.postMessage({ type: "ui/profile.open", login } satisfies UiInbound);
  renderProfileModerationControls(ctx);
}

export function bindProfileOpen(
  ctx: WebviewContext,
  el: HTMLElement,
  login: string,
  avatarUrl: string | undefined,
): void {
  el.addEventListener("click", () => openProfile(ctx, login, avatarUrl));
}

export function renderProfileModerationControls(ctx: WebviewContext): void {
  const activeProfileGithubUserId = ctx.state.activeProfileGithubUserId;

  const isOwnProfile =
    ctx.state.signedInGithubUserId !== null &&
    activeProfileGithubUserId === ctx.state.signedInGithubUserId;
  const isOperatorDenied =
    activeProfileGithubUserId !== null &&
    ctx.state.operatorDeniedGithubUserIds.has(activeProfileGithubUserId);
  const isRoomDenied =
    activeProfileGithubUserId !== null &&
    ctx.state.roomDeniedGithubUserIds.has(activeProfileGithubUserId);

  const canModerate =
    ctx.state.signedInIsModerator &&
    activeProfileGithubUserId !== null &&
    !isOwnProfile &&
    !isOperatorDenied;
  const shouldShowModeratorStatus =
    ctx.state.signedInIsModerator && activeProfileGithubUserId !== null && !isOwnProfile;

  if (ctx.els.profileActions) ctx.els.profileActions.hidden = !canModerate;
  if (ctx.els.profileBan) ctx.els.profileBan.hidden = !canModerate || isRoomDenied;
  if (ctx.els.profileUnban) ctx.els.profileUnban.hidden = !canModerate || !isRoomDenied;

  const canMessage = ctx.state.isConnected && activeProfileGithubUserId !== null && !isOwnProfile;
  if (ctx.els.profileMessage) {
    ctx.els.profileMessage.hidden = !canMessage;
    ctx.els.profileMessage.disabled = !canMessage;
  }

  let statusText = "";
  const action = ctx.state.moderationAction;
  if (action?.phase === "pending") {
    statusText = action.action === "deny" ? "Banning..." : "Unbanning...";
  } else if (action?.phase === "success") {
    statusText = action.action === "deny" ? "Banned." : "Unbanned.";
  } else if (action?.phase === "error") {
    statusText = action.message ?? "Moderation action failed.";
  } else if (shouldShowModeratorStatus) {
    if (isOperatorDenied) statusText = "Blocked by operator policy.";
    else if (isRoomDenied) statusText = "Banned from this room.";
  }

  setProfileModStatus(ctx, statusText);
}

export function bindProfileUiEvents(ctx: WebviewContext): void {
  ctx.els.profileClose?.addEventListener("click", () => closeOverlay(ctx));

  if (ctx.els.profileOverlay && ctx.els.profileCard) {
    ctx.els.profileOverlay.addEventListener("click", (e) => {
      if (e.target === ctx.els.profileOverlay) closeOverlay(ctx);
    });
  }

  ctx.els.profileOpenOnGitHub?.addEventListener("click", () => {
    if (!ctx.state.activeProfileLogin) return;
    ctx.vscode.postMessage({
      type: "ui/profile.openOnGitHub",
      login: ctx.state.activeProfileLogin,
    } satisfies UiInbound);
  });

  ctx.els.profileMessage?.addEventListener("click", () => {
    const githubUserId = ctx.state.activeProfileGithubUserId;
    const login = ctx.state.activeProfileLogin;
    const avatarUrl = ctx.els.profileAvatar?.src?.trim();
    if (!githubUserId || !login || !avatarUrl) return;

    ctx.vscode.postMessage({
      type: "ui/dm.open",
      peer: { githubUserId, login, avatarUrl, roles: [] },
    } satisfies UiInbound);
    closeOverlay(ctx);
    ctx.els.channelDm?.click();
  });

  ctx.els.profileBan?.addEventListener("click", () => {
    if (!ctx.state.activeProfileGithubUserId) return;
    ctx.vscode.postMessage({
      type: "ui/moderation.user.deny",
      targetGithubUserId: ctx.state.activeProfileGithubUserId,
    } satisfies UiInbound);
  });

  ctx.els.profileUnban?.addEventListener("click", () => {
    if (!ctx.state.activeProfileGithubUserId) return;
    ctx.vscode.postMessage({
      type: "ui/moderation.user.allow",
      targetGithubUserId: ctx.state.activeProfileGithubUserId,
    } satisfies UiInbound);
  });
}

export function handleExtModerationSnapshot(
  ctx: WebviewContext,
  msg: ExtModerationSnapshotMsg,
): void {
  ctx.state.operatorDeniedGithubUserIds = new Set(msg.operatorDeniedGithubUserIds);
  ctx.state.roomDeniedGithubUserIds = new Set(msg.roomDeniedGithubUserIds);
  renderProfileModerationControls(ctx);
}

export function handleExtModerationUserDenied(
  ctx: WebviewContext,
  msg: ExtModerationUserDeniedMsg,
): void {
  ctx.state.roomDeniedGithubUserIds.add(msg.targetGithubUserId);
  renderProfileModerationControls(ctx);
}

export function handleExtModerationUserAllowed(
  ctx: WebviewContext,
  msg: ExtModerationUserAllowedMsg,
): void {
  ctx.state.roomDeniedGithubUserIds.delete(msg.targetGithubUserId);
  renderProfileModerationControls(ctx);
}

export function handleExtModerationAction(ctx: WebviewContext, msg: ExtModerationActionMsg): void {
  ctx.state.moderationAction = msg;
  if (ctx.state.moderationAction.phase !== "pending") {
    // Keep the last message, but clear pending state once it's resolved.
    // This preserves a visible success/failure confirmation in the profile card.
  }
  renderProfileModerationControls(ctx);
}

export function handleExtProfileResult(ctx: WebviewContext, msg: ExtProfileResultMsg): void {
  if (msg.login.toLowerCase() !== ctx.state.activeProfileKey) return;
  renderProfile(ctx, msg.profile);
}

export function handleExtProfileError(ctx: WebviewContext, msg: ExtProfileErrorMsg): void {
  if (msg.login.toLowerCase() !== ctx.state.activeProfileKey) return;
  ctx.state.activeProfileGithubUserId = null;
  setProfileError(ctx, "Unable to load profile.");
  if (ctx.els.profileBody) {
    const detail = document.createElement("div");
    detail.className = "muted";
    detail.textContent = msg.message;
    ctx.els.profileBody.replaceChildren(detail);
  }
  renderProfileModerationControls(ctx);
}
