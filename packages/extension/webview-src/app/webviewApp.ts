import {
  ExtOutboundSchema,
  type ExtDmHistoryMsg,
  type ExtDmMessageMsg,
  type ExtDmStateMsg,
  type ExtState,
  type UiInbound,
} from "../../src/contract/webviewProtocol.js";
import { getElements } from "../dom/elements.js";
import { createInitialWebviewState } from "../state/webviewState.js";
import { hasModeratorRole } from "../features/userRoles.js";
import {
  addMessage,
  bindChatUiEvents,
  reclassifyMessages,
  renderHistory,
  renderGlobalConversation,
} from "../features/chat.js";
import {
  bindProfileUiEvents,
  handleExtModerationAction,
  handleExtModerationSnapshot,
  handleExtModerationUserAllowed,
  handleExtModerationUserDenied,
  handleExtProfileError,
  handleExtProfileResult,
  hideProfile,
  openProfile,
  renderProfileModerationControls,
} from "../features/profile.js";
import {
  bindPresenceUiEvents,
  handleExtPresence,
  hidePresenceOnEscape,
  renderPresence,
} from "../features/presence.js";
import type { VscodeWebviewApi, WebviewContext } from "./types.js";

declare const acquireVsCodeApi: <T>() => VscodeWebviewApi<T>;

const vscode = acquireVsCodeApi<UiInbound>();
const els = getElements();
const state = createInitialWebviewState();

const queueTask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (fn: () => void) => {
        void Promise.resolve().then(fn);
      };

const ctx: WebviewContext = { vscode, els, state, queueTask };

bindChatUiEvents(ctx);
bindPresenceUiEvents(ctx);
bindProfileUiEvents(ctx);

function renderChannelTabs(ctx: WebviewContext): void {
  const isGlobal = ctx.state.activeChannel === "global";
  if (ctx.els.channelGlobal) {
    ctx.els.channelGlobal.classList.toggle("active", isGlobal);
    ctx.els.channelGlobal.setAttribute("aria-selected", isGlobal ? "true" : "false");
  }
  if (ctx.els.channelDm) {
    ctx.els.channelDm.classList.toggle("active", !isGlobal);
    ctx.els.channelDm.setAttribute("aria-selected", !isGlobal ? "true" : "false");
  }

  if (ctx.els.dmPanel) ctx.els.dmPanel.hidden = ctx.state.activeChannel !== "dm";
}

function renderDmPanel(ctx: WebviewContext): void {
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

function renderDmWarning(ctx: WebviewContext): void {
  const dmId = ctx.state.activeDmId;
  const thread = dmId ? ctx.state.dmThreads.find((t) => t.dmId === dmId) : undefined;
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

function renderConversation(ctx: WebviewContext): void {
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

function renderComposer(ctx: WebviewContext): void {
  const canSendGlobal = ctx.state.isConnected && ctx.state.activeChannel === "global";

  const dmId = ctx.state.activeDmId;
  const activeThread = dmId ? ctx.state.dmThreads.find((t) => t.dmId === dmId) : undefined;
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
    if (!ctx.state.isConnected) ctx.els.input.placeholder = "Type a message…";
    else if (ctx.state.activeChannel === "global") ctx.els.input.placeholder = "Type a message…";
    else if (!dmId) ctx.els.input.placeholder = "Select a DM thread…";
    else if (activeThread?.isBlocked) ctx.els.input.placeholder = "DM blocked until trusted…";
    else ctx.els.input.placeholder = `Message @${activeThread?.peer.login ?? "user"}…`;
  }
}

function setError(text: string): void {
  if (!els.error) return;
  if (!text) {
    els.error.classList.remove("visible");
    els.error.textContent = "";
    return;
  }
  els.error.classList.add("visible");
  els.error.textContent = text;
}

function hideHeaderIdentity(): void {
  if (els.identity) els.identity.hidden = true;
  if (els.identityLogin) els.identityLogin.textContent = "";
  if (els.identityAvatar) {
    els.identityAvatar.alt = "";
    els.identityAvatar.src = "";
  }
}

function showHeaderIdentity(login: string, avatarUrl: string): void {
  if (els.identity) els.identity.hidden = false;
  if (els.identityLogin) els.identityLogin.textContent = login;
  if (els.identityAvatar) {
    els.identityAvatar.alt = login;
    els.identityAvatar.src = avatarUrl;
  }
}

function openHeaderIdentityProfile(): void {
  const login = els.identityLogin?.textContent?.trim();
  if (!login) return;
  const avatarUrl = els.identityAvatar?.src?.trim();
  openProfile(ctx, login, avatarUrl);
}

type HeaderAction = ExtState["actions"]["signIn"];

function renderAction(el: HTMLButtonElement | null, action: HeaderAction | undefined): void {
  if (!el || !action) return;
  el.hidden = !action.visible;
  el.disabled = !action.enabled;
  el.textContent = action.label;
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

function renderState(extState: ExtState): void {
  const wasConnected = ctx.state.isConnected;
  const status = extState.status ?? "unknown";
  ctx.state.isConnected = status === "connected";
  if (wasConnected && !ctx.state.isConnected) {
    let changed = false;
    for (const entry of ctx.state.outbox) {
      if (entry.phase !== "pending") continue;
      entry.phase = "error";
      entry.errorMessage = "Not connected.";
      changed = true;
    }
    if (changed && ctx.state.activeChannel === "global") renderGlobalConversation(ctx);
  }

  if (els.connButton) {
    els.connButton.hidden = false;
    els.connButton.disabled = !ctx.state.isConnected;
    els.connButton.dataset.connStatus = status;
  }

  if (els.connText) els.connText.textContent = toConnectionLabel(status);

  const prevSignedInLogin = ctx.state.signedInLoginLowerCase;
  ctx.state.signedInLoginLowerCase =
    "user" in extState && extState.user?.login ? extState.user.login.toLowerCase() : null;
  if (prevSignedInLogin !== ctx.state.signedInLoginLowerCase) reclassifyMessages(ctx);

  ctx.state.signedInGithubUserId =
    "user" in extState && extState.user?.githubUserId ? extState.user.githubUserId : null;
  ctx.state.signedInIsModerator =
    "user" in extState && extState.user ? hasModeratorRole(extState.user) : false;

  if ("user" in extState && extState.user?.login && extState.user.avatarUrl) {
    showHeaderIdentity(extState.user.login, extState.user.avatarUrl);
  } else {
    hideHeaderIdentity();
  }

  if (!ctx.state.isConnected) ctx.state.presenceSnapshot = null;
  renderPresence(ctx);

  renderChannelTabs(ctx);
  renderDmPanel(ctx);
  renderComposer(ctx);
  renderAction(els.signIn, extState.actions?.signIn);
  renderAction(els.reconnect, extState.actions?.connect);

  renderProfileModerationControls(ctx);
}

els.signIn?.addEventListener("click", () => ctx.vscode.postMessage({ type: "ui/signIn" }));
els.reconnect?.addEventListener("click", () => ctx.vscode.postMessage({ type: "ui/reconnect" }));
els.identity?.addEventListener("click", () => openHeaderIdentityProfile());
els.channelGlobal?.addEventListener("click", () => {
  ctx.state.activeChannel = "global";
  renderChannelTabs(ctx);
  renderDmPanel(ctx);
  renderConversation(ctx);
  renderComposer(ctx);
});
els.channelDm?.addEventListener("click", () => {
  ctx.state.activeChannel = "dm";
  renderChannelTabs(ctx);
  renderDmPanel(ctx);
  if (!ctx.state.activeDmId && ctx.state.dmThreads.length > 0) {
    ctx.state.activeDmId = ctx.state.dmThreads[0]?.dmId ?? null;
    if (ctx.state.activeDmId) {
      ctx.vscode.postMessage({
        type: "ui/dm.thread.select",
        dmId: ctx.state.activeDmId,
      } satisfies UiInbound);
    }
  }
  renderConversation(ctx);
  renderComposer(ctx);
});
els.dmTrust?.addEventListener("click", () => {
  const dmId = ctx.state.activeDmId;
  if (!dmId) return;
  ctx.vscode.postMessage({ type: "ui/dm.peerKey.trust", dmId } satisfies UiInbound);
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ctx.state.profileVisible) {
    e.preventDefault();
    hideProfile(ctx);
    return;
  }

  if (e.key === "Escape" && ctx.state.presenceVisible) {
    e.preventDefault();
    hidePresenceOnEscape(ctx);
  }
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const parsed = ExtOutboundSchema.safeParse(event.data);
  if (!parsed.success) return;

  const msg = parsed.data;

  switch (msg.type) {
    case "ext/state":
      setError("");
      renderState(msg.state);
      return;
    case "ext/history":
      ctx.state.globalHistory = msg.history;
      ctx.state.outbox = [];
      ctx.state.settledClientMessageIds.clear();
      if (ctx.state.activeChannel === "global") renderGlobalConversation(ctx);
      return;
    case "ext/message":
      if (!ctx.state.globalHistory.some((m) => m.id === msg.message.id)) {
        ctx.state.globalHistory.push(msg.message);
      }
      if (
        msg.clientMessageId &&
        !ctx.state.settledClientMessageIds.has(msg.clientMessageId) &&
        ctx.state.outbox.some((e) => e.clientMessageId === msg.clientMessageId)
      ) {
        ctx.state.outbox = ctx.state.outbox.filter(
          (e) => e.clientMessageId !== msg.clientMessageId,
        );
        ctx.state.settledClientMessageIds.add(msg.clientMessageId);
      }
      if (ctx.state.activeChannel === "global") renderGlobalConversation(ctx);
      renderComposer(ctx);
      return;
    case "ext/message.send.error": {
      if (ctx.state.settledClientMessageIds.has(msg.clientMessageId)) return;
      const entry = ctx.state.outbox.find((e) => e.clientMessageId === msg.clientMessageId);
      if (!entry) return;
      entry.phase = "error";
      entry.errorMessage = msg.message ?? msg.code;
      ctx.state.settledClientMessageIds.add(msg.clientMessageId);
      if (ctx.state.activeChannel === "global") renderGlobalConversation(ctx);
      renderComposer(ctx);
      return;
    }
    case "ext/dm.state":
      handleDmState(ctx, msg);
      return;
    case "ext/dm.history":
      handleDmHistory(ctx, msg);
      return;
    case "ext/dm.message":
      handleDmMessage(ctx, msg);
      return;
    case "ext/presence":
      handleExtPresence(ctx, msg);
      return;
    case "ext/moderation.snapshot":
      handleExtModerationSnapshot(ctx, msg);
      return;
    case "ext/moderation.user.denied":
      handleExtModerationUserDenied(ctx, msg);
      return;
    case "ext/moderation.user.allowed":
      handleExtModerationUserAllowed(ctx, msg);
      return;
    case "ext/moderation.action":
      handleExtModerationAction(ctx, msg);
      return;
    case "ext/error":
      setError(msg.message);
      return;
    case "ext/profile.result":
      handleExtProfileResult(ctx, msg);
      return;
    case "ext/profile.error":
      handleExtProfileError(ctx, msg);
      return;
  }
});

function handleDmState(ctx: WebviewContext, msg: ExtDmStateMsg): void {
  ctx.state.dmThreads = msg.threads;
  if (ctx.state.activeDmId && !ctx.state.dmThreads.some((t) => t.dmId === ctx.state.activeDmId)) {
    ctx.state.activeDmId = null;
  }
  renderChannelTabs(ctx);
  renderDmPanel(ctx);
  renderDmWarning(ctx);
  renderComposer(ctx);
}

function handleDmHistory(ctx: WebviewContext, msg: ExtDmHistoryMsg): void {
  ctx.state.dmMessagesById.set(msg.dmId, msg.history);
  if (ctx.state.activeChannel === "dm" && ctx.state.activeDmId === msg.dmId) {
    renderConversation(ctx);
  } else if (ctx.state.activeChannel === "dm" && ctx.state.activeDmId === null) {
    ctx.state.activeDmId = msg.dmId;
    renderChannelTabs(ctx);
    renderDmPanel(ctx);
    renderConversation(ctx);
  }
  renderComposer(ctx);
}

function handleDmMessage(ctx: WebviewContext, msg: ExtDmMessageMsg): void {
  const history = ctx.state.dmMessagesById.get(msg.message.dmId) ?? [];
  history.push(msg.message);
  ctx.state.dmMessagesById.set(msg.message.dmId, history);

  if (ctx.state.activeChannel === "dm" && ctx.state.activeDmId === msg.message.dmId) {
    addMessage(ctx, msg.message);
  }
  renderComposer(ctx);
}

ctx.vscode.postMessage({ type: "ui/ready" });
