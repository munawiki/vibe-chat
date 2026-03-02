import type { WebviewContext } from "./types.js";

export function getActiveDmThread(
  ctx: WebviewContext,
): (typeof ctx.state.channel.dmThreads)[number] | undefined {
  const dmId = ctx.state.channel.activeDmId;
  return dmId ? ctx.state.channel.dmThreads.find((t) => t.dmId === dmId) : undefined;
}

export function resolveComposerPlaceholder(options: {
  isConnected: boolean;
  activeChannel: WebviewContext["state"]["channel"]["activeChannel"];
  dmId: WebviewContext["state"]["channel"]["activeDmId"];
  activeThread: WebviewContext["state"]["channel"]["dmThreads"][number] | undefined;
}): string {
  if (!options.isConnected) return "Type a message…";
  if (options.activeChannel === "global") return "Type a message…";
  if (!options.dmId) return "Select a DM thread…";
  if (options.activeThread?.isBlocked) return "DM blocked until trusted…";
  return `Message @${options.activeThread?.peer.login ?? "user"}…`;
}

export function markOutboxPendingAsError(ctx: WebviewContext): boolean {
  let changed = false;
  for (const entry of ctx.state.outbox) {
    if (entry.phase !== "pending") continue;
    entry.phase = "error";
    entry.errorMessage = "Not connected.";
    changed = true;
  }
  return changed;
}

function canSendGlobal(ctx: WebviewContext): boolean {
  return ctx.state.auth.isConnected && ctx.state.channel.activeChannel === "global";
}

function canSendDm(
  ctx: WebviewContext,
  activeThread: WebviewContext["state"]["channel"]["dmThreads"][number] | undefined,
): boolean {
  if (!ctx.state.auth.isConnected) return false;
  if (ctx.state.channel.activeChannel !== "dm") return false;
  if (!ctx.state.channel.activeDmId) return false;
  if (!activeThread) return false;
  return !activeThread.isBlocked;
}

export function renderComposer(ctx: WebviewContext): void {
  const activeThread = getActiveDmThread(ctx);
  const dmId = ctx.state.channel.activeDmId;
  const canSend = canSendGlobal(ctx) || canSendDm(ctx, activeThread);

  if (ctx.els.send) ctx.els.send.disabled = !canSend;
  if (ctx.els.input) ctx.els.input.disabled = !canSend;

  if (ctx.els.input) {
    ctx.els.input.placeholder = resolveComposerPlaceholder({
      isConnected: ctx.state.auth.isConnected,
      activeChannel: ctx.state.channel.activeChannel,
      dmId,
      activeThread,
    });
  }
}
