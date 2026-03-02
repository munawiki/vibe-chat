import type { ChatMessagePlain, DmMessagePlain } from "@vscode-chat/protocol";
import type { WebviewContext } from "../app/types.js";
import type { OutboxEntry } from "../state/webviewState.js";
import { bindProfileOpen } from "./profile.js";
import { renderMessageText } from "./chatCodeHighlight.js";
import { createModBadge, hasModeratorRole } from "./userRoles.js";

type RenderableMessage = ChatMessagePlain | DmMessagePlain;

export function classifyMessageRow(
  ctx: WebviewContext,
  row: HTMLElement,
  authorLoginLowerCase: string,
): void {
  row.classList.toggle("own", authorLoginLowerCase === ctx.state.auth.signedInLoginLowerCase);
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

export function scrollMessagesToBottom(ctx: WebviewContext): void {
  if (!ctx.els.messages) return;
  ctx.els.messages.scrollTop = ctx.els.messages.scrollHeight;
}

export function createTimeEl(createdAt: string): HTMLElement {
  const time = document.createElement("span");
  time.className = "time muted";
  const ts = new Date(createdAt);
  time.textContent = Number.isNaN(ts.getTime())
    ? ""
    : ts.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return time;
}

export function createAvatar(
  ctx: WebviewContext,
  options: { login: string; avatarUrl: string | undefined; openProfile: boolean },
): HTMLImageElement {
  const avatar = document.createElement("img");
  avatar.className = options.openProfile ? "avatar clickable" : "avatar";
  avatar.alt = options.openProfile ? options.login : "";
  avatar.src = options.avatarUrl ?? "";
  if (options.openProfile) bindProfileOpen(ctx, avatar, options.login, options.avatarUrl);
  return avatar;
}

export function createAuthorButton(
  ctx: WebviewContext,
  options: { login: string; avatarUrl: string | undefined; openProfile: boolean },
): HTMLButtonElement {
  const author = document.createElement("button");
  author.type = "button";
  author.className = "login clickable";
  author.textContent = options.login;
  if (options.openProfile) bindProfileOpen(ctx, author, options.login, options.avatarUrl);
  return author;
}

export function createMessageRow(ctx: WebviewContext, message: RenderableMessage): HTMLElement {
  const row = document.createElement("div");
  row.className = "msg messageRow";
  row.dataset["authorLogin"] = message.user.login;

  const avatar = createAvatar(ctx, {
    login: message.user.login,
    avatarUrl: message.user.avatarUrl,
    openProfile: true,
  });

  const body = document.createElement("div");
  body.className = "body";

  const meta = document.createElement("div");
  meta.className = "meta";

  const author = createAuthorButton(ctx, {
    login: message.user.login,
    avatarUrl: message.user.avatarUrl,
    openProfile: true,
  });
  const time = createTimeEl(message.createdAt);

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

export function createOutboxRow(ctx: WebviewContext, entry: OutboxEntry): HTMLElement {
  const row = document.createElement("div");
  row.className = "msg messageRow outboxRow";
  row.classList.toggle("pending", entry.phase === "pending");
  row.classList.toggle("failed", entry.phase === "error");
  row.dataset["clientMessageId"] = entry.clientMessageId;

  const authorLoginLowerCase = ctx.state.auth.signedInLoginLowerCase ?? "";
  row.dataset["authorLogin"] = authorLoginLowerCase;

  const avatar = createAvatar(ctx, { login: "", avatarUrl: "", openProfile: false });

  const body = document.createElement("div");
  body.className = "body";

  const meta = document.createElement("div");
  meta.className = "meta";

  const author = createAuthorButton(ctx, {
    login: authorLoginLowerCase,
    avatarUrl: "",
    openProfile: false,
  });
  const time = createTimeEl(entry.createdAt);

  const status = document.createElement("span");
  status.className = "status muted";
  status.textContent =
    entry.phase === "pending" ? "Sending…" : entry.errorMessage?.trim() || "Failed";

  meta.append(author, time, status);

  const text = document.createElement("div");
  text.className = "text";
  renderMessageText(ctx, text, entry.text);

  body.append(meta, text);

  classifyMessageRow(ctx, row, authorLoginLowerCase);
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

export function renderGlobalConversation(ctx: WebviewContext): void {
  if (!ctx.els.messages) return;
  const fragment = document.createDocumentFragment();
  for (const message of ctx.state.globalHistory)
    fragment.appendChild(createMessageRow(ctx, message));
  for (const entry of ctx.state.outbox) fragment.appendChild(createOutboxRow(ctx, entry));
  ctx.els.messages.replaceChildren(fragment);
  scrollMessagesToBottom(ctx);
}

export function addMessage(ctx: WebviewContext, message: RenderableMessage): void {
  if (!ctx.els.messages) return;
  ctx.els.messages.appendChild(createMessageRow(ctx, message));
  scrollMessagesToBottom(ctx);
}
