import type { ExtState } from "../../src/contract/protocol/index.js";
import { hasModeratorRole } from "../features/userRoles.js";
import { reclassifyMessages, renderGlobalConversation } from "../features/chat.js";
import type { WebviewContext } from "./types.js";
import { markOutboxPendingAsError } from "./renderComposer.js";

type HeaderAction = ExtState["actions"]["signIn"];
type ConnectionStatus = ExtState["status"] | "unknown";

export function renderAction(el: HTMLButtonElement | null, action: HeaderAction | undefined): void {
  if (!el || !action) return;
  el.hidden = !action.visible;
  el.disabled = !action.enabled;
  el.textContent = action.label;
}

export function hideHeaderIdentity(ctx: WebviewContext): void {
  if (ctx.els.identity) ctx.els.identity.hidden = true;
  if (ctx.els.identityLogin) ctx.els.identityLogin.textContent = "";
  if (ctx.els.identityAvatar) {
    ctx.els.identityAvatar.alt = "";
    ctx.els.identityAvatar.src = "";
  }
}

export function showHeaderIdentity(ctx: WebviewContext, login: string, avatarUrl: string): void {
  if (ctx.els.identity) ctx.els.identity.hidden = false;
  if (ctx.els.identityLogin) ctx.els.identityLogin.textContent = login;
  if (ctx.els.identityAvatar) {
    ctx.els.identityAvatar.alt = login;
    ctx.els.identityAvatar.src = avatarUrl;
  }
}

export function toConnectionLabel(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "disconnected":
      return "Disconnected";
    default:
      return "Unknown";
  }
}

export function updateConnectionState(ctx: WebviewContext, status: ConnectionStatus): void {
  const wasConnected = ctx.state.auth.isConnected;
  ctx.state.auth.isConnected = status === "connected";
  if (wasConnected && !ctx.state.auth.isConnected) {
    const changed = markOutboxPendingAsError(ctx);
    if (changed && ctx.state.channel.activeChannel === "global") renderGlobalConversation(ctx);
  }

  if (ctx.els.connButton) {
    ctx.els.connButton.hidden = false;
    ctx.els.connButton.disabled = !ctx.state.auth.isConnected;
    ctx.els.connButton.dataset.connStatus = status;
  }

  if (ctx.els.connText) ctx.els.connText.textContent = toConnectionLabel(status);
}

export function updateSignedInUserState(ctx: WebviewContext, extState: ExtState): void {
  const user = "user" in extState ? extState.user : undefined;

  const prevSignedInLogin = ctx.state.auth.signedInLoginLowerCase;
  ctx.state.auth.signedInLoginLowerCase = user?.login ? user.login.toLowerCase() : null;
  if (prevSignedInLogin !== ctx.state.auth.signedInLoginLowerCase) reclassifyMessages(ctx);

  ctx.state.auth.signedInGithubUserId = user?.githubUserId ?? null;
  ctx.state.auth.signedInIsModerator = user ? hasModeratorRole(user) : false;

  if (user?.login && user.avatarUrl) {
    showHeaderIdentity(ctx, user.login, user.avatarUrl);
  } else {
    hideHeaderIdentity(ctx);
  }
}
