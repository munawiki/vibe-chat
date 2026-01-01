import { describe, expect, it } from "vitest";
import {
  appendHistory,
  createChatMessage,
  nextFixedWindowRateLimit,
} from "../src/policy/chatRoomPolicy.js";

describe("chatRoomPolicy", () => {
  it("enforces fixed window rate limits deterministically", () => {
    const opts = { windowMs: 1000, maxCount: 2 };

    const r1 = nextFixedWindowRateLimit(undefined, 0, opts);
    expect(r1.allowed).toBe(true);
    expect(r1.nextWindow).toEqual({ windowStartMs: 0, count: 1 });

    const r2 = nextFixedWindowRateLimit(r1.nextWindow, 500, opts);
    expect(r2.allowed).toBe(true);
    expect(r2.nextWindow).toEqual({ windowStartMs: 0, count: 2 });

    const r3 = nextFixedWindowRateLimit(r2.nextWindow, 900, opts);
    expect(r3.allowed).toBe(false);
    if (!r3.allowed) expect(r3.retryAfterMs).toBe(100);
    expect(r3.nextWindow).toEqual({ windowStartMs: 0, count: 2 });

    const r4 = nextFixedWindowRateLimit(r3.nextWindow, 1000, opts);
    expect(r4.allowed).toBe(true);
    expect(r4.nextWindow).toEqual({ windowStartMs: 1000, count: 1 });
  });

  it("appends history and trims to limit", () => {
    const m1 = createChatMessage({
      id: "1",
      user: { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" },
      text: "hi",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const m2 = { ...m1, id: "2" };
    const m3 = { ...m1, id: "3" };

    const h1 = appendHistory([], m1, 2);
    expect(h1).toEqual([m1]);

    const h2 = appendHistory(h1, m2, 2);
    expect(h2).toEqual([m1, m2]);

    const h3 = appendHistory(h2, m3, 2);
    expect(h3).toEqual([m2, m3]);
  });
});
