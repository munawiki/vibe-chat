import { ExtOutboundSchema, type UiInbound } from "../../src/contract/webviewProtocol.js";
import { bindChatUiEvents } from "../features/chat.js";
import { bindPresenceUiEvents } from "../features/presence.js";
import { bindProfileUiEvents, openProfile } from "../features/profile.js";
import { closeOverlay } from "../features/overlay.js";
import { dispatchExtOutbound } from "./extRouter.js";
import { renderChannelTabs, renderComposer, renderConversation, renderDmPanel } from "./render.js";
import type { WebviewContext } from "./types.js";

function openHeaderIdentityProfile(ctx: WebviewContext): void {
  const login = ctx.els.identityLogin?.textContent?.trim();
  if (!login) return;
  const avatarUrl = ctx.els.identityAvatar?.src?.trim();
  openProfile(ctx, login, avatarUrl);
}

function bindShellUiEvents(ctx: WebviewContext): void {
  ctx.els.signIn?.addEventListener("click", () => ctx.vscode.postMessage({ type: "ui/signIn" }));
  ctx.els.reconnect?.addEventListener("click", () =>
    ctx.vscode.postMessage({ type: "ui/reconnect" }),
  );
  ctx.els.identity?.addEventListener("click", () => openHeaderIdentityProfile(ctx));

  ctx.els.channelGlobal?.addEventListener("click", () => {
    ctx.state.activeChannel = "global";
    renderChannelTabs(ctx);
    renderDmPanel(ctx);
    renderConversation(ctx);
    renderComposer(ctx);
  });

  ctx.els.channelDm?.addEventListener("click", () => {
    ctx.state.activeChannel = "dm";
    if (!ctx.state.activeDmId && ctx.state.dmThreads.length > 0) {
      ctx.state.activeDmId = ctx.state.dmThreads[0]?.dmId ?? null;
      if (ctx.state.activeDmId) {
        ctx.vscode.postMessage({
          type: "ui/dm.thread.select",
          dmId: ctx.state.activeDmId,
        } satisfies UiInbound);
      }
    }
    renderChannelTabs(ctx);
    renderDmPanel(ctx);
    renderConversation(ctx);
    renderComposer(ctx);
  });

  ctx.els.dmTrust?.addEventListener("click", () => {
    const dmId = ctx.state.activeDmId;
    if (!dmId) return;
    ctx.vscode.postMessage({ type: "ui/dm.peerKey.trust", dmId } satisfies UiInbound);
  });
}

function bindOverlayEscape(ctx: WebviewContext): void {
  globalThis.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!closeOverlay(ctx)) return;
    e.preventDefault();
  });
}

function bindExtOutboundListener(ctx: WebviewContext): void {
  globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.origin !== globalThis.location.origin) return;

    const parsed = ExtOutboundSchema.safeParse(event.data);
    if (!parsed.success) return;

    dispatchExtOutbound(ctx, parsed.data);
  });
}

export function startWebviewApp(ctx: WebviewContext): void {
  bindChatUiEvents(ctx);
  bindPresenceUiEvents(ctx);
  bindProfileUiEvents(ctx);

  bindShellUiEvents(ctx);
  bindOverlayEscape(ctx);
  bindExtOutboundListener(ctx);

  ctx.vscode.postMessage({ type: "ui/ready" });
}
