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

export function deriveChatStatusBarPresentation(
  state: ChatClientState,
  presenceSnapshot: PresenceSnapshot | undefined,
  opts?: DeriveOpts,
): ChatStatusBarPresentation {
  const topN = Math.max(1, opts?.topN ?? 10);

  if (state.status === "disconnected") {
    return { visible: false, text: "", tooltipMarkdown: "" };
  }

  const onlineCount = presenceSnapshot ? String(presenceSnapshot.length) : "—";
  const statusText = state.status === "connected" ? "Connected" : "Connecting";
  const icon = state.status === "connected" ? "$(comment-discussion)" : "$(sync~spin)";

  const text =
    state.status === "connected"
      ? `${icon} Chat: Online: ${onlineCount}`
      : `${icon} Chat: ${statusText} · Online: ${onlineCount}`;

  const tooltipLines: string[] = [
    "**VS Code Chat**",
    `Status: ${toMarkdownCodeSpan(state.status)}`,
    `Online: ${toMarkdownCodeSpan(onlineCount)}`,
  ];

  if (!presenceSnapshot) {
    tooltipLines.push("", "_Online user list unavailable._");
    return { visible: true, text, tooltipMarkdown: tooltipLines.join("\n") };
  }

  if (presenceSnapshot.length === 0) {
    tooltipLines.push("", "_No one online._");
    return { visible: true, text, tooltipMarkdown: tooltipLines.join("\n") };
  }

  tooltipLines.push("", "Online users:");

  const shown = presenceSnapshot.slice(0, topN);
  for (const entry of shown) {
    const login = toMarkdownCodeSpan(entry.user.login);
    const conn = entry.connections > 1 ? ` ×${entry.connections}` : "";
    tooltipLines.push(`- ${login}${conn}`);
  }

  const remaining = presenceSnapshot.length - shown.length;
  if (remaining > 0) {
    tooltipLines.push(`- …and ${remaining} more`);
  }

  return { visible: true, text, tooltipMarkdown: tooltipLines.join("\n") };
}
