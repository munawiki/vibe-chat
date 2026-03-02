import type { ExtProfileResultMsg, UiInbound } from "../../src/contract/protocol/index.js";
import type { WebviewContext } from "../app/types.js";
import { openOverlay } from "./overlay.js";
import { renderProfileModerationControls } from "./profileModeration.js";

export function setProfileError(ctx: WebviewContext, text: string): void {
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

export function setProfileAvatar(
  ctx: WebviewContext,
  login: string,
  avatarUrl: string | undefined,
): void {
  if (!ctx.els.profileAvatar) return;
  ctx.els.profileAvatar.alt = login;
  ctx.els.profileAvatar.src = avatarUrl ?? "";
}

export function appendProfileDetail(
  fragment: DocumentFragment,
  className: string,
  text: string | null | undefined,
): void {
  if (!text) return;
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  fragment.appendChild(el);
}

export function buildProfileBody(profile: ExtProfileResultMsg["profile"]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  appendProfileDetail(fragment, "profileBio", profile.bio);
  appendProfileDetail(fragment, "profileDetail", profile.company);
  appendProfileDetail(fragment, "profileDetail", profile.location);
  appendProfileDetail(fragment, "profileDetail", profile.blog);
  return fragment;
}

export function renderProfileLoading(
  ctx: WebviewContext,
  login: string,
  avatarUrl: string | undefined,
): void {
  setProfileError(ctx, "");
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

export function renderProfile(ctx: WebviewContext, profile: ExtProfileResultMsg["profile"]): void {
  ctx.state.overlay.activeProfileGithubUserId = profile.githubUserId;
  if (ctx.els.profileName) ctx.els.profileName.textContent = profile.name ?? "";
  if (ctx.els.profileLogin) ctx.els.profileLogin.textContent = profile.login;
  if (ctx.els.profileBody) ctx.els.profileBody.replaceChildren(buildProfileBody(profile));
  setProfileAvatar(ctx, profile.login, profile.avatarUrl);
  renderProfileModerationControls(ctx);
}

export function openProfile(
  ctx: WebviewContext,
  login: string,
  avatarUrl: string | undefined,
): void {
  ctx.state.overlay.activeProfileLogin = login;
  ctx.state.overlay.activeProfileKey = login.toLowerCase();
  ctx.state.overlay.activeProfileGithubUserId = null;
  ctx.state.moderation.moderationAction = null;
  renderProfileLoading(ctx, login, avatarUrl);
  openOverlay(ctx, "profile");
  ctx.vscode.postMessage({ type: "ui/profile.open", login } satisfies UiInbound);
  renderProfileModerationControls(ctx);
}
