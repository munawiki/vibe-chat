import { describe, expect, it } from "vitest";
import { AuthUserSchema } from "@vscode-chat/protocol";
import {
  appendHistory,
  createChatMessagePlain,
  nextHistoryPersistence,
  nextFixedWindowRateLimit,
} from "../src/policy/chatRoomPolicy.js";

function makeUser() {
  return AuthUserSchema.parse({
    githubUserId: "123",
    login: "octocat",
    avatarUrl: "https://example.com/a.png",
    roles: [],
  });
}

function makeMessage(user: ReturnType<typeof makeUser>, id: string) {
  return createChatMessagePlain({
    id,
    user,
    text: "hello",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

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
    const user = makeUser();
    const m1 = makeMessage(user, "1");
    const m2 = makeMessage(user, "2");
    const m3 = makeMessage(user, "3");

    const h1 = appendHistory([], m1, 2);
    expect(h1).toEqual([m1]);

    const h2 = appendHistory(h1, m2, 2);
    expect(h2).toEqual([m1, m2]);

    const h3 = appendHistory(h2, m3, 2);
    expect(h3).toEqual([m2, m3]);
  });

  it("returns empty history when limit is 0", () => {
    const user = makeUser();
    const m1 = makeMessage(user, "1");

    expect(appendHistory([], m1, 0)).toEqual([]);
  });

  it("persists history every N messages", () => {
    expect(nextHistoryPersistence(0, 3)).toEqual({ shouldPersist: false, nextPendingCount: 1 });
    expect(nextHistoryPersistence(1, 3)).toEqual({ shouldPersist: false, nextPendingCount: 2 });
    expect(nextHistoryPersistence(2, 3)).toEqual({ shouldPersist: true, nextPendingCount: 0 });
  });
});
