import type { ExtState, UiInbound } from "../../src/contract/webviewProtocol.js";
import { hasModeratorRole } from "../features/userRoles.js";
import { reclassifyMessages, renderHistory, renderGlobalConversation } from "../features/chat.js";
import { renderProfileModerationControls } from "../features/profile.js";
import { renderPresence } from "../features/presence.js";
import type { WebviewContext } from "./types.js";

type HeaderAction = ExtState["actions"]["signIn"];

function renderAction(el: HTMLButtonElement | null, action: HeaderAction | undefined): void {
  if (!el || !action) return;
  el.hidden = !action.visible;
  el.disabled = !action.enabled;
  el.textContent = action.label;
}

export function setError(ctx: WebviewContext, text: string): void {
  if (!ctx.els.error) return;
  if (!text) {
    ctx.els.error.classList.remove("visible");
    ctx.els.error.textContent = "";
    return;
  }
  ctx.els.error.classList.add("visible");
  ctx.els.error.textContent = text;
}

function hideHeaderIdentity(ctx: WebviewContext): void {
  if (ctx.els.identity) ctx.els.identity.hidden = true;
  if (ctx.els.identityLogin) ctx.els.identityLogin.textContent = "";
  if (ctx.els.identityAvatar) {
    ctx.els.identityAvatar.alt = "";
    ctx.els.identityAvatar.src = "";
  }
}

function showHeaderIdentity(ctx: WebviewContext, login: string, avatarUrl: string): void {
  if (ctx.els.identity) ctx.els.identity.hidden = false;
  if (ctx.els.identityLogin) ctx.els.identityLogin.textContent = login;
  if (ctx.els.identityAvatar) {
    ctx.els.identityAvatar.alt = login;
    ctx.els.identityAvatar.src = avatarUrl;
  }
}

export function renderChannelTabs(ctx: WebviewContext): void {
  const isGlobal = ctx.state.activeChannel === "global";
  const isDm = ctx.state.activeChannel === "dm";
  if (ctx.els.channelGlobal) {
    ctx.els.channelGlobal.classList.toggle("active", isGlobal);
    ctx.els.channelGlobal.setAttribute("aria-selected", isGlobal ? "true" : "false");
  }
  if (ctx.els.channelDm) {
    ctx.els.channelDm.classList.toggle("active", isDm);
    ctx.els.channelDm.setAttribute("aria-selected", isDm ? "true" : "false");
  }

  if (ctx.els.dmPanel) ctx.els.dmPanel.hidden = ctx.state.activeChannel !== "dm";
}

export function renderDmWarning(ctx: WebviewContext): void {
  const thread = getActiveDmThread(ctx);
  const warning = thread?.warning;

  if (!ctx.els.dmWarning || !ctx.els.dmWarningText || !ctx.els.dmTrust) return;

  if (!thread || !thread.isBlocked || !warning) {
    ctx.els.dmWarning.hidden = true;
    ctx.els.dmWarningText.textContent = "";
    ctx.els.dmTrust.hidden = true;
    ctx.els.dmTrust.disabled = true;
    return;
  }

  ctx.els.dmWarning.hidden = false;
  ctx.els.dmWarningText.textContent = warning;
  ctx.els.dmTrust.hidden = !thread.canTrustKey;
  ctx.els.dmTrust.disabled = !thread.canTrustKey;
}

export function renderDmPanel(ctx: WebviewContext): void {
  if (!ctx.els.dmThreads) return;

  const threads = ctx.state.dmThreads;
  if (threads.length === 0) {
    ctx.els.dmThreads.replaceChildren();
    if (ctx.els.dmEmpty) ctx.els.dmEmpty.hidden = false;
    if (ctx.els.dmWarning) ctx.els.dmWarning.hidden = true;
    return;
  }

  if (ctx.els.dmEmpty) ctx.els.dmEmpty.hidden = true;

  const fragment = document.createDocumentFragment();
  for (const thread of threads) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dmThread";
    btn.dataset["dmId"] = thread.dmId;
    btn.textContent = thread.peer.login;
    btn.classList.toggle("active", thread.dmId === ctx.state.activeDmId);
    btn.classList.toggle("blocked", thread.isBlocked);
    btn.addEventListener("click", () => {
      ctx.state.activeChannel = "dm";
      ctx.state.activeDmId = thread.dmId;
      renderChannelTabs(ctx);
      renderDmPanel(ctx);
      renderConversation(ctx);
      renderComposer(ctx);
      ctx.vscode.postMessage({
        type: "ui/dm.thread.select",
        dmId: thread.dmId,
      } satisfies UiInbound);
    });
    fragment.appendChild(btn);
  }

  ctx.els.dmThreads.replaceChildren(fragment);
  renderDmWarning(ctx);
}

export function renderConversation(ctx: WebviewContext): void {
  if (!ctx.els.messages) return;

  if (ctx.state.activeChannel === "global") {
    renderGlobalConversation(ctx);
    return;
  }

  const dmId = ctx.state.activeDmId;
  if (!dmId) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = ctx.state.dmThreads.length === 0 ? "No DMs yet." : "Select a DM thread.";
    ctx.els.messages.replaceChildren(empty);
    return;
  }

  const history = ctx.state.dmMessagesById.get(dmId) ?? [];
  renderHistory(ctx, history);
}

export function renderComposer(ctx: WebviewContext): void {
  const canSendGlobal = ctx.state.isConnected && ctx.state.activeChannel === "global";
  const dmId = ctx.state.activeDmId;
  const activeThread = getActiveDmThread(ctx);
  const canSendDm =
    ctx.state.isConnected &&
    ctx.state.activeChannel === "dm" &&
    !!dmId &&
    !!activeThread &&
    !activeThread.isBlocked;

  const canSend = canSendGlobal || canSendDm;

  if (ctx.els.send) ctx.els.send.disabled = !canSend;
  if (ctx.els.input) ctx.els.input.disabled = !canSend;

  if (ctx.els.input) {
    ctx.els.input.placeholder = resolveComposerPlaceholder({
      isConnected: ctx.state.isConnected,
      activeChannel: ctx.state.activeChannel,
      dmId,
      activeThread,
    });
  }
}

function getActiveDmThread(ctx: WebviewContext): (typeof ctx.state.dmThreads)[number] | undefined {
  const dmId = ctx.state.activeDmId;
  return dmId ? ctx.state.dmThreads.find((t) => t.dmId === dmId) : undefined;
}

function resolveComposerPlaceholder(options: {
  isConnected: boolean;
  activeChannel: WebviewContext["state"]["activeChannel"];
  dmId: WebviewContext["state"]["activeDmId"];
  activeThread: WebviewContext["state"]["dmThreads"][number] | undefined;
}): string {
  if (!options.isConnected) return "Type a message…";
  if (options.activeChannel === "global") return "Type a message…";
  if (!options.dmId) return "Select a DM thread…";
  if (options.activeThread?.isBlocked) return "DM blocked until trusted…";
  return `Message @${options.activeThread?.peer.login ?? "user"}…`;
}

type ConnectionStatus = ExtState["status"] | "unknown";

function toConnectionLabel(status: ConnectionStatus): string {
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

function markOutboxPendingAsError(ctx: WebviewContext): boolean {
  let changed = false;
  for (const entry of ctx.state.outbox) {
    if (entry.phase !== "pending") continue;
    entry.phase = "error";
    entry.errorMessage = "Not connected.";
    changed = true;
  }
  return changed;
}

function updateConnectionState(ctx: WebviewContext, status: ConnectionStatus): void {
  const wasConnected = ctx.state.isConnected;
  ctx.state.isConnected = status === "connected";
  if (wasConnected && !ctx.state.isConnected) {
    const changed = markOutboxPendingAsError(ctx);
    if (changed && ctx.state.activeChannel === "global") renderGlobalConversation(ctx);
  }

  if (ctx.els.connButton) {
    ctx.els.connButton.hidden = false;
    ctx.els.connButton.disabled = !ctx.state.isConnected;
    ctx.els.connButton.dataset.connStatus = status;
  }

  if (ctx.els.connText) ctx.els.connText.textContent = toConnectionLabel(status);
}

function updateSignedInUserState(ctx: WebviewContext, extState: ExtState): void {
  const user = "user" in extState ? extState.user : undefined;

  const prevSignedInLogin = ctx.state.signedInLoginLowerCase;
  ctx.state.signedInLoginLowerCase = user?.login ? user.login.toLowerCase() : null;
  if (prevSignedInLogin !== ctx.state.signedInLoginLowerCase) reclassifyMessages(ctx);

  ctx.state.signedInGithubUserId = user?.githubUserId ?? null;
  ctx.state.signedInIsModerator = user ? hasModeratorRole(user) : false;

  if (user?.login && user.avatarUrl) {
    showHeaderIdentity(ctx, user.login, user.avatarUrl);
  } else {
    hideHeaderIdentity(ctx);
  }
}

export function renderState(ctx: WebviewContext, extState: ExtState): void {
  const status: ConnectionStatus = extState.status ?? "unknown";
  updateConnectionState(ctx, status);
  updateSignedInUserState(ctx, extState);

  if (!ctx.state.isConnected) ctx.state.presenceSnapshot = null;
  renderPresence(ctx);

  renderChannelTabs(ctx);
  renderDmPanel(ctx);
  renderComposer(ctx);
  renderAction(ctx.els.signIn, extState.actions?.signIn);
  renderAction(ctx.els.reconnect, extState.actions?.connect);

  renderProfileModerationControls(ctx);
}
