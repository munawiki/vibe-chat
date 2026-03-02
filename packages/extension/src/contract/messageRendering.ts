import LinkifyIt from "linkify-it";
import { normalizeExternalHref } from "./safeLinks.js";

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
  const segments = messageText.split("```");
  if (segments.length % 2 === 0) return [{ kind: "text", text: messageText }];

  const out: FenceToken[] = [];
  pushMergedText(out, segments[0] ?? "");

  for (let i = 1; i < segments.length; i += 2) {
    const fenceContent = segments[i] ?? "";
    const newlineIndex = fenceContent.indexOf("\n");
    const rawInfo = newlineIndex === -1 ? "" : fenceContent.slice(0, newlineIndex);
    const codeText = newlineIndex === -1 ? fenceContent : fenceContent.slice(newlineIndex + 1);
    out.push({
      kind: "codeBlock",
      text: codeText,
      languageHint: normalizeFenceInfoToLanguageHint(rawInfo),
    });
    pushMergedText(out, segments[i + 1] ?? "");
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

  const prev = out.at(-1);
  if (prev?.kind === "text") prev.text += text;
  else out.push({ kind: "text", text });
}
