import type { ChatMessage } from "@vscode-chat/protocol";
import type { RateWindow } from "../util.js";

export type RateLimitDecision =
  | { allowed: true; nextWindow: RateWindow }
  | { allowed: false; retryAfterMs: number; nextWindow: RateWindow };

export function nextFixedWindowRateLimit(
  previous: RateWindow | undefined,
  nowMs: number,
  options: { windowMs: number; maxCount: number },
): RateLimitDecision {
  const window = previous;

  if (!window || nowMs - window.windowStartMs >= options.windowMs) {
    return { allowed: true, nextWindow: { windowStartMs: nowMs, count: 1 } };
  }

  if (window.count >= options.maxCount) {
    const retryAfterMs = Math.max(0, options.windowMs - (nowMs - window.windowStartMs));
    return { allowed: false, retryAfterMs, nextWindow: window };
  }

  return {
    allowed: true,
    nextWindow: { windowStartMs: window.windowStartMs, count: window.count + 1 },
  };
}

export function appendHistory(
  history: ChatMessage[],
  message: ChatMessage,
  limit: number,
): ChatMessage[] {
  return [...history, message].slice(-limit);
}

export function createChatMessage(options: {
  id: string;
  user: ChatMessage["user"];
  text: string;
  createdAt: string;
}): ChatMessage {
  return { id: options.id, user: options.user, text: options.text, createdAt: options.createdAt };
}
