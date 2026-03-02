import type { UiInbound } from "../../src/contract/protocol/index.js";
import { tokenizeMessageText, type MessageToken } from "../../src/contract/messageRendering.js";
import { assertNever } from "@vscode-chat/protocol";
import { tokenize, type ShjLanguage, type ShjToken } from "@speed-highlight/core";
import { detectLanguage } from "@speed-highlight/core/detect";
import type { WebviewContext } from "../app/types.js";

const LANGUAGE_ALIAS_MAP: Readonly<Record<string, ShjLanguage>> = {
  typescript: "ts",
  javascript: "js",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  plaintext: "plain",
  text: "plain",
};

export function createMessageLink(
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

export function normalizeLanguageHint(languageHint: string | null): ShjLanguage | null {
  if (!languageHint) return null;
  const token = languageHint.trim().split(/\s+/)[0]?.trim().toLowerCase();
  if (!token) return null;
  return LANGUAGE_ALIAS_MAP[token] ?? (token as ShjLanguage);
}

export function pickHighlightLanguage(codeText: string, languageHint: string | null): ShjLanguage {
  return normalizeLanguageHint(languageHint) ?? detectLanguage(codeText);
}

export function renderHighlightNode(text: string, tokenType: ShjToken | undefined): Node {
  if (!tokenType) return document.createTextNode(text);
  const span = document.createElement("span");
  span.className = `shj-syn-${tokenType}`;
  span.textContent = text;
  return span;
}

export async function highlightCode(
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

export function createCodeBlock(codeText: string, languageHint: string | null): HTMLElement {
  const container = document.createElement("div");
  container.className = "msgCode";

  const code = document.createElement("code");
  code.textContent = codeText;
  container.appendChild(code);

  const language = pickHighlightLanguage(codeText, languageHint);
  void highlightCode(code, codeText, language);

  return container;
}

export function renderMessageText(
  ctx: WebviewContext,
  container: HTMLElement,
  messageText: string,
): void {
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
