import type { PresenceSnapshot } from "@vscode-chat/protocol";
import type { ChatClientState } from "../core/chatClientCore.js";

export type ChatStatusBarPresentation = {
  visible: boolean;
  text: string;
  tooltipMarkdown: string;
};

type DeriveOpts = {
  topN?: number;
};

function toMarkdownCodeSpan(text: string): string {
  const ticks = text.match(/`+/g);
  const maxTickLen = ticks ? Math.max(...ticks.map((t) => t.length)) : 0;
  const fence = "`".repeat(maxTickLen + 1);
  const padded = text.startsWith(" ") || text.endsWith(" ") ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
}

function statusTextAndIcon(status: ChatClientState["status"]): {
  statusText: string;
  icon: string;
} {
  return status === "connected"
    ? { statusText: "Connected", icon: "$(comment-discussion)" }
    : { statusText: "Connecting", icon: "$(sync~spin)" };
}

function buildBaseTooltip(
  state: ChatClientState,
  onlineCount: string,
): { text: string; tooltipLines: string[] } {
  const { statusText, icon } = statusTextAndIcon(state.status);
  const text =
    state.status === "connected"
      ? `${icon} Chat: Online: ${onlineCount}`
      : `${icon} Chat: ${statusText} · Online: ${onlineCount}`;
  return {
    text,
    tooltipLines: [
      "**Vibe Chat**",
      `Status: ${toMarkdownCodeSpan(state.status)}`,
      `Online: ${toMarkdownCodeSpan(onlineCount)}`,
    ],
  };
}

function buildPresenceLines(
  presenceSnapshot: PresenceSnapshot | undefined,
  topN: number,
): string[] {
  if (!presenceSnapshot) return ["", "_Online user list unavailable._"];
  if (presenceSnapshot.length === 0) return ["", "_No one online._"];

  const lines = ["", "Online users:"];
  const shown = presenceSnapshot.slice(0, topN);
  for (const entry of shown) {
    const login = toMarkdownCodeSpan(entry.user.login);
    const conn = entry.connections > 1 ? ` ×${entry.connections}` : "";
    lines.push(`- ${login}${conn}`);
  }

  const remaining = presenceSnapshot.length - shown.length;
  if (remaining > 0) lines.push(`- …and ${remaining} more`);
  return lines;
}

export function deriveChatStatusBarPresentation(
  state: ChatClientState,
  presenceSnapshot: PresenceSnapshot | undefined,
  opts?: DeriveOpts,
): ChatStatusBarPresentation {
  if (state.status === "disconnected") {
    return { visible: false, text: "", tooltipMarkdown: "" };
  }

  const topN = Math.max(1, opts?.topN ?? 10);
  const onlineCount = presenceSnapshot ? String(presenceSnapshot.length) : "—";
  const base = buildBaseTooltip(state, onlineCount);
  const lines = [...base.tooltipLines, ...buildPresenceLines(presenceSnapshot, topN)];
  return { visible: true, text: base.text, tooltipMarkdown: lines.join("\n") };
}
