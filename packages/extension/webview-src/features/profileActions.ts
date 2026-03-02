import type {
  ExtProfileErrorMsg,
  ExtProfileResultMsg,
  UiInbound,
} from "../../src/contract/protocol/index.js";
import type { WebviewContext } from "../app/types.js";
import { closeOverlay } from "./overlay.js";
import { openProfile, renderProfile, setProfileError } from "./profileOverlay.js";
import { renderProfileModerationControls } from "./profileModeration.js";

export function canMessageProfile(options: {
  isConnected: boolean;
  activeProfileGithubUserId: string | null;
  isOwnProfile: boolean;
}): boolean {
  if (!options.isConnected) return false;
  if (options.activeProfileGithubUserId === null) return false;
  if (options.isOwnProfile) return false;
  return true;
}

export function bindProfileOpen(
  ctx: WebviewContext,
  el: HTMLElement,
  login: string,
  avatarUrl: string | undefined,
): void {
  el.addEventListener("click", () => openProfile(ctx, login, avatarUrl));
}

export function bindProfileUiEvents(ctx: WebviewContext): void {
  ctx.els.profileClose?.addEventListener("click", () => closeOverlay(ctx));

  if (ctx.els.profileOverlay && ctx.els.profileCard) {
    ctx.els.profileOverlay.addEventListener("click", (e) => {
      if (e.target === ctx.els.profileOverlay) closeOverlay(ctx);
    });
  }

  ctx.els.profileOpenOnGitHub?.addEventListener("click", () => {
    if (!ctx.state.overlay.activeProfileLogin) return;
    ctx.vscode.postMessage({
      type: "ui/profile.openOnGitHub",
      login: ctx.state.overlay.activeProfileLogin,
    } satisfies UiInbound);
  });

  ctx.els.profileMessage?.addEventListener("click", () => {
    const githubUserId = ctx.state.overlay.activeProfileGithubUserId;
    const login = ctx.state.overlay.activeProfileLogin;
    const avatarUrl = ctx.els.profileAvatar?.src?.trim();
    if (!githubUserId || !login || !avatarUrl) return;

    ctx.vscode.postMessage({
      type: "ui/dm.open",
      peer: { githubUserId, login, avatarUrl, roles: [] },
    } satisfies UiInbound);
    closeOverlay(ctx);
    ctx.els.channelDm?.click();
  });

  ctx.els.profileSignOut?.addEventListener("click", () => {
    ctx.vscode.postMessage({ type: "ui/signOut" } satisfies UiInbound);
    closeOverlay(ctx);
  });

  ctx.els.profileBan?.addEventListener("click", () => {
    if (!ctx.state.overlay.activeProfileGithubUserId) return;
    ctx.vscode.postMessage({
      type: "ui/moderation.user.deny",
      targetGithubUserId: ctx.state.overlay.activeProfileGithubUserId,
    } satisfies UiInbound);
  });

  ctx.els.profileUnban?.addEventListener("click", () => {
    if (!ctx.state.overlay.activeProfileGithubUserId) return;
    ctx.vscode.postMessage({
      type: "ui/moderation.user.allow",
      targetGithubUserId: ctx.state.overlay.activeProfileGithubUserId,
    } satisfies UiInbound);
  });
}

export function handleExtProfileResult(ctx: WebviewContext, msg: ExtProfileResultMsg): void {
  if (msg.login.toLowerCase() !== ctx.state.overlay.activeProfileKey) return;
  renderProfile(ctx, msg.profile);
}

export function handleExtProfileError(ctx: WebviewContext, msg: ExtProfileErrorMsg): void {
  if (msg.login.toLowerCase() !== ctx.state.overlay.activeProfileKey) return;
  ctx.state.overlay.activeProfileGithubUserId = null;
  setProfileError(ctx, "Unable to load profile.");
  if (ctx.els.profileBody) {
    const detail = document.createElement("div");
    detail.className = "muted";
    detail.textContent = msg.message;
    ctx.els.profileBody.replaceChildren(detail);
  }
  renderProfileModerationControls(ctx);
}
