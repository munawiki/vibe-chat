import { boundFixedWindowRateLimitStore } from "../util.js";
import type { RateWindow } from "../util.js";
import { nextFixedWindowRateLimit } from "../policy/chatRoomPolicy.js";
import type { ChatRoomGuardrails } from "../config.js";
import { ROOM_RATE_LIMIT_MAX_TRACKED_KEYS } from "./constants.js";
import type { GithubUserId } from "@vscode-chat/protocol";

export class ChatRoomRateLimits {
  private readonly rateByUser = new Map<GithubUserId, RateWindow>();
  private readonly connectRateByIp = new Map<string, RateWindow>();

  constructor(private readonly config: Pick<ChatRoomGuardrails, "messageRate" | "connectRate">) {}

  checkMessageRateLimit(
    githubUserId: GithubUserId,
  ): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const nowMs = Date.now();
    boundFixedWindowRateLimitStore(this.rateByUser, nowMs, {
      windowMs: this.config.messageRate.windowMs,
      maxTrackedKeys: ROOM_RATE_LIMIT_MAX_TRACKED_KEYS,
    });
    const decision = nextFixedWindowRateLimit(this.rateByUser.get(githubUserId), nowMs, {
      windowMs: this.config.messageRate.windowMs,
      maxCount: this.config.messageRate.maxCount,
    });

    this.rateByUser.delete(githubUserId);
    this.rateByUser.set(githubUserId, decision.nextWindow);
    return decision.allowed
      ? { allowed: true }
      : { allowed: false, retryAfterMs: decision.retryAfterMs };
  }

  checkConnectRateLimit(key: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const nowMs = Date.now();
    boundFixedWindowRateLimitStore(this.connectRateByIp, nowMs, {
      windowMs: this.config.connectRate.windowMs,
      maxTrackedKeys: ROOM_RATE_LIMIT_MAX_TRACKED_KEYS,
    });
    const decision = nextFixedWindowRateLimit(this.connectRateByIp.get(key), nowMs, {
      windowMs: this.config.connectRate.windowMs,
      maxCount: this.config.connectRate.maxCount,
    });

    this.connectRateByIp.delete(key);
    this.connectRateByIp.set(key, decision.nextWindow);
    return decision.allowed
      ? { allowed: true }
      : { allowed: false, retryAfterMs: decision.retryAfterMs };
  }
}
