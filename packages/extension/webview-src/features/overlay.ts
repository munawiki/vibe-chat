import type { WebviewContext } from "../app/types.js";
import { reduceActiveOverlay, type OverlayKind } from "../state/overlayState.js";

function assertNever(x: never): never {
  throw new Error(`unreachable: ${JSON.stringify(x)}`);
}

function closeProfileOverlay(ctx: WebviewContext): void {
  ctx.state.activeProfileLogin = "";
  ctx.state.activeProfileKey = "";
  ctx.state.activeProfileGithubUserId = null;
  ctx.state.moderationAction = null;

  if (ctx.els.profileError) {
    ctx.els.profileError.hidden = true;
    ctx.els.profileError.textContent = "";
  }
  if (ctx.els.profileModStatus) {
    ctx.els.profileModStatus.hidden = true;
    ctx.els.profileModStatus.textContent = "";
  }
  if (ctx.els.profileBody) ctx.els.profileBody.textContent = "";
  if (ctx.els.profileActions) ctx.els.profileActions.hidden = true;
  if (ctx.els.profileMessage) ctx.els.profileMessage.hidden = true;
  if (ctx.els.profileOverlay) ctx.els.profileOverlay.hidden = true;
}

function closePresenceOverlay(ctx: WebviewContext): void {
  if (ctx.els.presenceOverlay) ctx.els.presenceOverlay.hidden = true;
  ctx.els.connButton?.setAttribute("aria-expanded", "false");
}

function showProfileOverlay(ctx: WebviewContext): void {
  if (!ctx.els.profileOverlay) return;
  ctx.els.profileOverlay.hidden = false;
  ctx.els.profileClose?.focus();
}

function showPresenceOverlay(ctx: WebviewContext): void {
  if (!ctx.els.presenceOverlay) return;
  ctx.els.presenceOverlay.hidden = false;
  ctx.els.presenceClose?.focus();
  ctx.els.connButton?.setAttribute("aria-expanded", "true");
}

export function closeOverlay(ctx: WebviewContext): boolean {
  const active = ctx.state.activeOverlay.kind;
  if (active === "none") return false;

  switch (active) {
    case "profile":
      closeProfileOverlay(ctx);
      break;
    case "presence":
      closePresenceOverlay(ctx);
      break;
    default:
      assertNever(active);
  }

  ctx.state.activeOverlay = reduceActiveOverlay(ctx.state.activeOverlay, { type: "overlay.close" });
  return true;
}

export function openOverlay(ctx: WebviewContext, kind: OverlayKind): void {
  const active = ctx.state.activeOverlay.kind;
  if (active !== "none" && active !== kind) closeOverlay(ctx);

  ctx.state.activeOverlay = reduceActiveOverlay(ctx.state.activeOverlay, {
    type: "overlay.open",
    kind,
  });

  switch (kind) {
    case "profile":
      showProfileOverlay(ctx);
      break;
    case "presence":
      showPresenceOverlay(ctx);
      break;
    default:
      assertNever(kind);
  }
}
