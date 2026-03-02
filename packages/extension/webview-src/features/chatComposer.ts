import type { UiInbound } from "../../src/contract/protocol/index.js";
import type { WebviewContext } from "../app/types.js";
import { renderGlobalConversation } from "./chatMessages.js";

export function isComposerSendKeydown(
  e: Pick<KeyboardEvent, "key" | "code" | "shiftKey">,
): boolean {
  if (e.shiftKey) return false;
  if (e.key === "Enter") return true;
  return e.code === "Enter" || e.code === "NumpadEnter";
}

export function sendCurrent(ctx: WebviewContext): void {
  if (!ctx.els.input) return;
  const text = ctx.els.input.value;
  if (!text.trim()) return;
  if (ctx.state.channel.activeChannel === "dm") {
    const dmId = ctx.state.channel.activeDmId;
    if (!dmId) return;
    ctx.vscode.postMessage({ type: "ui/dm.send", dmId, text } satisfies UiInbound);
  } else {
    const clientMessageId = crypto.randomUUID();
    ctx.state.outbox.push({
      clientMessageId,
      text,
      createdAt: new Date().toISOString(),
      phase: "pending",
    });
    renderGlobalConversation(ctx);
    ctx.vscode.postMessage({ type: "ui/send", text, clientMessageId } satisfies UiInbound);
  }
  ctx.els.input.value = "";
}

export function bindChatUiEvents(ctx: WebviewContext): void {
  ctx.els.send?.addEventListener("click", () => sendCurrent(ctx));

  if (!ctx.els.input) return;

  ctx.els.input.addEventListener("compositionstart", () => {
    ctx.state.ime.inputIsComposing = true;
  });
  ctx.els.input.addEventListener("compositionend", () => {
    ctx.state.ime.inputIsComposing = false;
    if (!ctx.state.ime.sendPendingAfterComposition) return;
    ctx.state.ime.sendPendingAfterComposition = false;
    ctx.state.ime.suppressEnterUntilMs = Date.now() + 100;
    setTimeout(() => sendCurrent(ctx), 0);
  });
  ctx.els.input.addEventListener("keydown", (e) => {
    if (!isComposerSendKeydown(e)) return;

    if (ctx.state.ime.inputIsComposing || e.isComposing) {
      ctx.state.ime.sendPendingAfterComposition = true;
      return;
    }

    e.preventDefault();
    if (Date.now() < ctx.state.ime.suppressEnterUntilMs) return;
    sendCurrent(ctx);
  });
}
