import type { UiInbound } from "../../src/contract/protocol/index.js";
import type { WebviewContext } from "./types.js";
import { renderHistory, renderGlobalConversation } from "../features/chat.js";
import { renderComposer } from "./renderComposer.js";

export function renderChannelTabs(ctx: WebviewContext): void {
  const isGlobal = ctx.state.channel.activeChannel === "global";
  const isDm = ctx.state.channel.activeChannel === "dm";
  if (ctx.els.channelGlobal) {
    ctx.els.channelGlobal.classList.toggle("active", isGlobal);
    ctx.els.channelGlobal.setAttribute("aria-selected", isGlobal ? "true" : "false");
  }
  if (ctx.els.channelDm) {
    ctx.els.channelDm.classList.toggle("active", isDm);
    ctx.els.channelDm.setAttribute("aria-selected", isDm ? "true" : "false");
  }
  if (ctx.els.dmPanel) ctx.els.dmPanel.hidden = ctx.state.channel.activeChannel !== "dm";
}

export function getActiveDmThread(
  ctx: WebviewContext,
): (typeof ctx.state.channel.dmThreads)[number] | undefined {
  const dmId = ctx.state.channel.activeDmId;
  return dmId ? ctx.state.channel.dmThreads.find((t) => t.dmId === dmId) : undefined;
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

export function renderConversation(ctx: WebviewContext): void {
  if (!ctx.els.messages) return;

  if (ctx.state.channel.activeChannel === "global") {
    renderGlobalConversation(ctx);
    return;
  }

  const dmId = ctx.state.channel.activeDmId;
  if (!dmId) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent =
      ctx.state.channel.dmThreads.length === 0 ? "No DMs yet." : "Select a DM thread.";
    ctx.els.messages.replaceChildren(empty);
    return;
  }

  const history = ctx.state.channel.dmMessagesById.get(dmId) ?? [];
  renderHistory(ctx, history);
}

export function renderDmPanel(ctx: WebviewContext): void {
  if (!ctx.els.dmThreads) return;

  const threads = ctx.state.channel.dmThreads;
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
    btn.classList.toggle("active", thread.dmId === ctx.state.channel.activeDmId);
    btn.classList.toggle("blocked", thread.isBlocked);
    btn.addEventListener("click", () => {
      ctx.state.channel.activeChannel = "dm";
      ctx.state.channel.activeDmId = thread.dmId;
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
