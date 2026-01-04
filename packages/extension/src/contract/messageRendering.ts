import LinkifyIt from "linkify-it";
import { normalizeExternalHref } from "./safeLinks.js";

/**
 * Safe message tokenization for Webview rendering.
 *
 * Why:
 * - The chat payload remains plain text end-to-end.
 * - The Webview may provide safe, read-only presentation enhancements (links + code blocks).
 *
 * Invariants:
 * - Never produce tokens that require `innerHTML` to render.
 * - Only `http(s)` links are emitted as `link` tokens.
 * - Links are not recognized inside code blocks.
 * - Unclosed triple-backtick fences disable code-block parsing for the whole message.
 */

export type MessageToken =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "codeBlock"; text: string; languageHint: string | null };

type FenceToken =
  | { kind: "text"; text: string }
  | { kind: "codeBlock"; text: string; languageHint: string | null };

const linkify = new LinkifyIt();

export function tokenizeMessageText(messageText: string): MessageToken[] {
  const fenceTokens = tokenizeCodeFences(messageText);
  const out: MessageToken[] = [];

  for (const token of fenceTokens) {
    if (token.kind === "codeBlock") {
      out.push(token);
      continue;
    }
    tokenizeLinks(out, token.text);
  }

  return out;
}

function tokenizeCodeFences(messageText: string): FenceToken[] {
  const out: FenceToken[] = [];

  let cursor = 0;
  while (cursor < messageText.length) {
    const start = messageText.indexOf("```", cursor);
    if (start === -1) {
      pushMergedText(out, messageText.slice(cursor));
      break;
    }

    const end = messageText.indexOf("```", start + 3);
    if (end === -1) return [{ kind: "text", text: messageText }];

    pushMergedText(out, messageText.slice(cursor, start));

    const afterFence = start + 3;
    const firstNewline = messageText.indexOf("\n", afterFence);

    const rawInfo =
      firstNewline !== -1 && firstNewline < end ? messageText.slice(afterFence, firstNewline) : "";
    const languageHint = normalizeFenceInfoToLanguageHint(rawInfo);

    const codeStart = firstNewline !== -1 && firstNewline < end ? firstNewline + 1 : afterFence;
    out.push({ kind: "codeBlock", text: messageText.slice(codeStart, end), languageHint });

    cursor = end + 3;
  }

  return out;
}

function normalizeFenceInfoToLanguageHint(info: string): string | null {
  const token = info.trim().split(/\s+/)[0]?.trim();
  if (!token) return null;
  return token.toLowerCase();
}

function tokenizeLinks(out: MessageToken[], text: string): void {
  const matches = linkify.match(text);
  if (!matches) {
    pushMergedText(out, text);
    return;
  }

  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) pushMergedText(out, text.slice(cursor, match.index));

    const raw = text.slice(match.index, match.lastIndex);
    const hrefCandidate = raw.startsWith("www.") ? raw : match.url;
    const href = normalizeExternalHref(hrefCandidate);
    if (href) out.push({ kind: "link", text: raw, href });
    else pushMergedText(out, raw);

    cursor = match.lastIndex;
  }

  if (cursor < text.length) pushMergedText(out, text.slice(cursor));
}

function pushMergedText(out: FenceToken[], text: string): void;
function pushMergedText(out: MessageToken[], text: string): void;
function pushMergedText(out: Array<FenceToken | MessageToken>, text: string): void {
  if (!text) return;

  const prev = out[out.length - 1];
  if (prev?.kind === "text") prev.text += text;
  else out.push({ kind: "text", text });
}
