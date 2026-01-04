import type { ExtPresenceMsg } from "../../src/contract/webviewProtocol.js";
import type { WebviewContext } from "../app/types.js";
import { createModBadge, hasModeratorRole } from "./userRoles.js";
import { bindProfileOpen } from "./profile.js";

function renderPresenceTitle(ctx: WebviewContext): void {
  if (!ctx.els.presenceTitle) return;
  const count = ctx.state.presenceSnapshot?.length;
  ctx.els.presenceTitle.textContent =
    typeof count === "number" ? `Online users (${count})` : "Online users";
}

function hidePresence(ctx: WebviewContext): void {
  ctx.state.presenceVisible = false;
  if (!ctx.els.presenceOverlay) return;
  ctx.els.presenceOverlay.hidden = true;
  ctx.els.connButton?.setAttribute("aria-expanded", "false");
}

function showPresence(ctx: WebviewContext): void {
  if (!ctx.els.presenceOverlay) return;
  ctx.els.presenceOverlay.hidden = false;
  ctx.state.presenceVisible = true;
  ctx.els.presenceClose?.focus();
  ctx.els.connButton?.setAttribute("aria-expanded", "true");
}

function openPresence(ctx: WebviewContext): void {
  if (!ctx.state.isConnected) return;
  showPresence(ctx);
}

function renderPresencePanel(ctx: WebviewContext): void {
  if (!ctx.els.presencePanel) return;

  if (!ctx.state.presenceSnapshot) {
    const empty = document.createElement("div");
    empty.className = "presenceEmpty muted";
    empty.textContent = "Online users unavailable.";
    ctx.els.presencePanel.replaceChildren(empty);
    return;
  }

  if (ctx.state.presenceSnapshot.length === 0) {
    const empty = document.createElement("div");
    empty.className = "presenceEmpty muted";
    empty.textContent = "No one online.";
    ctx.els.presencePanel.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of ctx.state.presenceSnapshot) {
    const user = entry.user;
    const row = document.createElement("div");
    row.className = "presenceUser";

    const avatar = document.createElement("img");
    avatar.className = "presenceAvatar clickable";
    avatar.src = user.avatarUrl ?? "";
    avatar.alt = user.login;
    bindProfileOpen(ctx, avatar, user.login, user.avatarUrl);

    const label = document.createElement("div");
    label.className = "presenceLabel";

    const login = document.createElement("button");
    login.className = "presenceLogin clickable";
    login.type = "button";
    login.textContent = user.login;
    bindProfileOpen(ctx, login, user.login, user.avatarUrl);

    label.appendChild(login);
    if (hasModeratorRole(user)) label.appendChild(createModBadge());

    row.append(avatar, label);
    fragment.appendChild(row);
  }

  ctx.els.presencePanel.replaceChildren(fragment);
}

export function renderPresence(ctx: WebviewContext): void {
  if (!ctx.state.isConnected) hidePresence(ctx);
  renderPresenceTitle(ctx);
  renderPresencePanel(ctx);
}

export function bindPresenceUiEvents(ctx: WebviewContext): void {
  ctx.els.connButton?.addEventListener("click", () => openPresence(ctx));
  ctx.els.presenceClose?.addEventListener("click", () => hidePresence(ctx));

  if (ctx.els.presenceOverlay && ctx.els.presenceCard) {
    ctx.els.presenceOverlay.addEventListener("click", (e) => {
      if (e.target === ctx.els.presenceOverlay) hidePresence(ctx);
    });
  }
}

export function handleExtPresence(ctx: WebviewContext, msg: ExtPresenceMsg): void {
  ctx.state.presenceSnapshot = msg.snapshot;
  renderPresence(ctx);
}

export function hidePresenceOnEscape(ctx: WebviewContext): void {
  if (!ctx.state.presenceVisible) return;
  hidePresence(ctx);
}
