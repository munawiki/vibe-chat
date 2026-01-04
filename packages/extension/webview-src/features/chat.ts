import { tokenizeMessageText, type MessageToken } from "../../src/contract/messageRendering.js";
import type { ChatMessagePlain, DmMessagePlain } from "@vscode-chat/protocol";
import type { UiInbound } from "../../src/contract/webviewProtocol.js";
import { tokenize, type ShjLanguage, type ShjToken } from "@speed-highlight/core";
import { detectLanguage } from "@speed-highlight/core/detect";
import type { WebviewContext } from "../app/types.js";
import { hasModeratorRole, createModBadge } from "./userRoles.js";
import { bindProfileOpen } from "./profile.js";

function assertNever(x: never): never {
  throw new Error(`unreachable: ${JSON.stringify(x)}`);
}

function classifyMessageRow(
  ctx: WebviewContext,
  row: HTMLElement,
  authorLoginLowerCase: string,
): void {
  row.classList.toggle("own", authorLoginLowerCase === ctx.state.signedInLoginLowerCase);
}

export function reclassifyMessages(ctx: WebviewContext): void {
  if (!ctx.els.messages) return;
  const rows = ctx.els.messages.querySelectorAll<HTMLElement>(".messageRow");
  rows.forEach((row) => {
    const authorLoginLowerCase = row.dataset["authorLogin"]?.toLowerCase();
    if (!authorLoginLowerCase) return;
    classifyMessageRow(ctx, row, authorLoginLowerCase);
  });
}

function scrollMessagesToBottom(ctx: WebviewContext): void {
  if (!ctx.els.messages) return;
  ctx.els.messages.scrollTop = ctx.els.messages.scrollHeight;
}

function createMessageLink(
  ctx: WebviewContext,
  token: Extract<MessageToken, { kind: "link" }>,
): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "messageLink";
  el.textContent = token.text;
  el.addEventListener("click", () => {
    ctx.vscode.postMessage({ type: "ui/link.open", href: token.href } satisfies UiInbound);
  });
  return el;
}

function normalizeLanguageHint(languageHint: string | null): ShjLanguage | null {
  if (!languageHint) return null;
  const token = languageHint.trim().split(/\s+/)[0]?.trim().toLowerCase();
  if (!token) return null;
  if (token === "typescript") return "ts";
  if (token === "javascript") return "js";
  if (token === "sh" || token === "shell") return "bash";
  if (token === "yml") return "yaml";
  if (token === "plaintext" || token === "text") return "plain";
  return token as ShjLanguage;
}

function pickHighlightLanguage(codeText: string, languageHint: string | null): ShjLanguage {
  const hint = normalizeLanguageHint(languageHint);
  if (hint) return hint;
  return detectLanguage(codeText);
}

function createCodeBlock(codeText: string, languageHint: string | null): HTMLElement {
  const container = document.createElement("div");
  container.className = "msgCode";

  const code = document.createElement("code");
  code.textContent = codeText;
  container.appendChild(code);

  const language = pickHighlightLanguage(codeText, languageHint);
  void highlightCode(code, codeText, language);

  return container;
}

async function highlightCode(
  codeEl: HTMLElement,
  codeText: string,
  language: ShjLanguage,
): Promise<void> {
  try {
    const fragment = document.createDocumentFragment();
    await tokenize(codeText, language, (text, tokenType) => {
      fragment.appendChild(renderHighlightNode(text, tokenType));
    });
    codeEl.replaceChildren(fragment);
  } catch {
    codeEl.textContent = codeText;
  }
}

function renderHighlightNode(text: string, tokenType: ShjToken | undefined): Node {
  if (!tokenType) return document.createTextNode(text);
  const span = document.createElement("span");
  span.className = `shj-syn-${tokenType}`;
  span.textContent = text;
  return span;
}

function renderMessageText(ctx: WebviewContext, container: HTMLElement, messageText: string): void {
  container.replaceChildren();
  const tokens = tokenizeMessageText(messageText);
  for (const token of tokens) {
    switch (token.kind) {
      case "text":
        container.appendChild(document.createTextNode(token.text));
        continue;
      case "link":
        container.appendChild(createMessageLink(ctx, token));
        continue;
      case "codeBlock":
        container.appendChild(createCodeBlock(token.text, token.languageHint));
        continue;
      default:
        assertNever(token);
    }
  }
}

type RenderableMessage = ChatMessagePlain | DmMessagePlain;

function createMessageRow(ctx: WebviewContext, message: RenderableMessage): HTMLElement {
  const row = document.createElement("div");
  row.className = "msg messageRow";
  row.dataset["authorLogin"] = message.user.login;

  const avatar = document.createElement("img");
  avatar.className = "avatar clickable";
  avatar.alt = message.user.login;
  avatar.src = message.user.avatarUrl ?? "";
  bindProfileOpen(ctx, avatar, message.user.login, message.user.avatarUrl);

  const body = document.createElement("div");
  body.className = "body";

  const meta = document.createElement("div");
  meta.className = "meta";

  const author = document.createElement("button");
  author.type = "button";
  author.className = "login clickable";
  author.textContent = message.user.login;
  bindProfileOpen(ctx, author, message.user.login, message.user.avatarUrl);

  const time = document.createElement("span");
  time.className = "time muted";
  const ts = new Date(message.createdAt);
  time.textContent = Number.isNaN(ts.getTime())
    ? ""
    : ts.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  meta.append(author);
  if (hasModeratorRole(message.user)) meta.appendChild(createModBadge());
  meta.append(time);

  const text = document.createElement("div");
  text.className = "text";
  renderMessageText(ctx, text, message.text);

  body.append(meta, text);

  classifyMessageRow(ctx, row, message.user.login.toLowerCase());
  row.append(avatar, body);

  return row;
}

export function renderHistory(
  ctx: WebviewContext,
  history: ReadonlyArray<RenderableMessage>,
): void {
  if (!ctx.els.messages) return;
  const fragment = document.createDocumentFragment();
  for (const message of history) fragment.appendChild(createMessageRow(ctx, message));
  ctx.els.messages.replaceChildren(fragment);
  scrollMessagesToBottom(ctx);
}

export function addMessage(ctx: WebviewContext, message: RenderableMessage): void {
  if (!ctx.els.messages) return;
  ctx.els.messages.appendChild(createMessageRow(ctx, message));
  scrollMessagesToBottom(ctx);
}

/**
 * Why:
 * - IME composition can report `Enter` as `key="Process"` (not `"Enter"`), so relying on `key` alone
 *   can miss the user's "send" intent and force an extra Enter press after composition ends.
 *
 * Invariants:
 * - `Shift+Enter` is reserved for newline (must NOT send).
 */
export function isComposerSendKeydown(
  e: Pick<KeyboardEvent, "key" | "code" | "shiftKey">,
): boolean {
  if (e.shiftKey) return false;
  if (e.key === "Enter") return true;
  return e.code === "Enter" || e.code === "NumpadEnter";
}

function sendCurrent(ctx: WebviewContext): void {
  if (!ctx.els.input) return;
  const text = ctx.els.input.value;
  if (!text.trim()) return;
  if (ctx.state.activeChannel === "dm") {
    const dmId = ctx.state.activeDmId;
    if (!dmId) return;
    ctx.vscode.postMessage({ type: "ui/dm.send", dmId, text } satisfies UiInbound);
  } else {
    ctx.vscode.postMessage({ type: "ui/send", text } satisfies UiInbound);
  }
  ctx.els.input.value = "";
}

export function bindChatUiEvents(ctx: WebviewContext): void {
  ctx.els.send?.addEventListener("click", () => sendCurrent(ctx));

  if (ctx.els.input) {
    ctx.els.input.addEventListener("compositionstart", () => {
      ctx.state.inputIsComposing = true;
    });
    ctx.els.input.addEventListener("compositionend", () => {
      ctx.state.inputIsComposing = false;
      if (!ctx.state.sendPendingAfterComposition) return;
      ctx.state.sendPendingAfterComposition = false;
      ctx.state.suppressEnterUntilMs = Date.now() + 100;
      // Why `setTimeout(0)` (macrotask) instead of a microtask:
      // - Some IME implementations commit the final composed text *after* `compositionend` but *before* the next task.
      // - If we read `textarea.value` in a microtask, we can observe a stale value and drop the send, forcing an extra Enter.
      setTimeout(() => sendCurrent(ctx), 0);
    });
    ctx.els.input.addEventListener("keydown", (e) => {
      if (isComposerSendKeydown(e)) {
        if (ctx.state.inputIsComposing || e.isComposing) {
          ctx.state.sendPendingAfterComposition = true;
          return;
        }

        e.preventDefault();
        if (Date.now() < ctx.state.suppressEnterUntilMs) return;
        sendCurrent(ctx);
      }
    });
  }
}
