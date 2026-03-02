import type { ExtState } from "../../src/contract/protocol/index.js";
import { renderPresence } from "../features/presence.js";
import { renderProfileModerationControls } from "../features/profile.js";
import { renderComposer } from "./renderComposer.js";
import {
  renderAction,
  updateConnectionState,
  updateSignedInUserState,
} from "./renderConnection.js";
import { renderChannelTabs, renderDmPanel } from "./renderDm.js";
import type { WebviewContext } from "./types.js";

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

export function renderState(ctx: WebviewContext, extState: ExtState): void {
  const status = extState.status ?? "unknown";
  updateConnectionState(ctx, status);
  updateSignedInUserState(ctx, extState);

  if (!ctx.state.auth.isConnected) ctx.state.presenceSnapshot = null;
  renderPresence(ctx);

  renderChannelTabs(ctx);
  renderDmPanel(ctx);
  renderComposer(ctx);
  renderAction(ctx.els.signIn, extState.actions?.signIn);
  renderAction(ctx.els.reconnect, extState.actions?.connect);

  renderProfileModerationControls(ctx);
}
