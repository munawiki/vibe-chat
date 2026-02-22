import type { ExtOutbound } from "../../src/contract/webviewProtocol.js";
import { addMessage, renderGlobalConversation } from "../features/chat.js";
import {
  handleExtModerationAction,
  handleExtModerationSnapshot,
  handleExtModerationUserAllowed,
  handleExtModerationUserDenied,
  handleExtProfileError,
  handleExtProfileResult,
} from "../features/profile.js";
import { handleExtPresence } from "../features/presence.js";
import {
  renderChannelTabs,
  renderComposer,
  renderConversation,
  renderDmPanel,
  renderDmWarning,
  renderState,
  setError,
} from "./render.js";
import type { WebviewContext } from "./types.js";

function handleExtHistory(
  ctx: WebviewContext,
  msg: Extract<ExtOutbound, { type: "ext/history" }>,
): void {
  ctx.state.globalHistory = msg.history;
  ctx.state.outbox = [];
  ctx.state.settledClientMessageIds.clear();
  if (ctx.state.activeChannel === "global") renderGlobalConversation(ctx);
}

function handleExtMessage(
  ctx: WebviewContext,
  msg: Extract<ExtOutbound, { type: "ext/message" }>,
): void {
  if (!ctx.state.globalHistory.some((m) => m.id === msg.message.id)) {
    ctx.state.globalHistory.push(msg.message);
  }

  if (
    msg.clientMessageId &&
    !ctx.state.settledClientMessageIds.has(msg.clientMessageId) &&
    ctx.state.outbox.some((e) => e.clientMessageId === msg.clientMessageId)
  ) {
    ctx.state.outbox = ctx.state.outbox.filter((e) => e.clientMessageId !== msg.clientMessageId);
    ctx.state.settledClientMessageIds.add(msg.clientMessageId);
  }

  if (ctx.state.activeChannel === "global") renderGlobalConversation(ctx);
  renderComposer(ctx);
}

function handleExtMessageSendError(
  ctx: WebviewContext,
  msg: Extract<ExtOutbound, { type: "ext/message.send.error" }>,
): void {
  if (ctx.state.settledClientMessageIds.has(msg.clientMessageId)) return;
  const entry = ctx.state.outbox.find((e) => e.clientMessageId === msg.clientMessageId);
  if (!entry) return;
  entry.phase = "error";
  entry.errorMessage = msg.message ?? msg.code;
  ctx.state.settledClientMessageIds.add(msg.clientMessageId);
  if (ctx.state.activeChannel === "global") renderGlobalConversation(ctx);
  renderComposer(ctx);
}

function handleDmState(
  ctx: WebviewContext,
  msg: Extract<ExtOutbound, { type: "ext/dm.state" }>,
): void {
  ctx.state.dmThreads = msg.threads;
  if (ctx.state.activeDmId && !ctx.state.dmThreads.some((t) => t.dmId === ctx.state.activeDmId)) {
    ctx.state.activeDmId = null;
  }
  renderChannelTabs(ctx);
  renderDmPanel(ctx);
  renderDmWarning(ctx);
  renderComposer(ctx);
}

function handleDmHistory(
  ctx: WebviewContext,
  msg: Extract<ExtOutbound, { type: "ext/dm.history" }>,
): void {
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

function handleDmMessage(
  ctx: WebviewContext,
  msg: Extract<ExtOutbound, { type: "ext/dm.message" }>,
): void {
  const history = ctx.state.dmMessagesById.get(msg.message.dmId) ?? [];
  history.push(msg.message);
  ctx.state.dmMessagesById.set(msg.message.dmId, history);

  if (ctx.state.activeChannel === "dm" && ctx.state.activeDmId === msg.message.dmId) {
    addMessage(ctx, msg.message);
  }
  renderComposer(ctx);
}

type HandlerMap = {
  [T in ExtOutbound["type"]]: (ctx: WebviewContext, msg: Extract<ExtOutbound, { type: T }>) => void;
};

const handlers = {
  "ext/state": (ctx, msg) => {
    setError(ctx, "");
    renderState(ctx, msg.state);
  },
  "ext/history": handleExtHistory,
  "ext/message": handleExtMessage,
  "ext/message.send.error": handleExtMessageSendError,
  "ext/dm.state": handleDmState,
  "ext/dm.history": handleDmHistory,
  "ext/dm.message": handleDmMessage,
  "ext/presence": handleExtPresence,
  "ext/moderation.snapshot": handleExtModerationSnapshot,
  "ext/moderation.user.denied": handleExtModerationUserDenied,
  "ext/moderation.user.allowed": handleExtModerationUserAllowed,
  "ext/moderation.action": handleExtModerationAction,
  "ext/error": (ctx, msg) => setError(ctx, msg.message),
  "ext/profile.result": handleExtProfileResult,
  "ext/profile.error": handleExtProfileError,
} satisfies HandlerMap;

export function dispatchExtOutbound(ctx: WebviewContext, msg: ExtOutbound): void {
  const handler = handlers[msg.type] as (ctx: WebviewContext, msg: ExtOutbound) => void;
  handler(ctx, msg);
}
