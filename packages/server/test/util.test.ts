import { describe, expect, it, vi } from "vitest";
import {
  checkFixedWindowRateLimit,
  getClientIp,
  parseBearerToken,
  parseGithubUserIdDenylist,
} from "../src/util.js";

describe("server util", () => {
  it("parses bearer tokens", () => {
    expect(parseBearerToken(null)).toBeUndefined();
    expect(parseBearerToken("")).toBeUndefined();
    expect(parseBearerToken("Basic abc")).toBeUndefined();
    expect(parseBearerToken("Bearer abc")).toBe("abc");
    expect(parseBearerToken("bearer   abc.def ")).toBe("abc.def");
  });

  it("parses denylist values", () => {
    expect(parseGithubUserIdDenylist(undefined).size).toBe(0);
    expect(parseGithubUserIdDenylist("").size).toBe(0);
    expect([...parseGithubUserIdDenylist(" 1, 2 , ,3 ")]).toEqual(["1", "2", "3"]);
  });

  it("prefers cf-connecting-ip when extracting client ip", () => {
    const request = new Request("https://example.com", {
      headers: {
        "cf-connecting-ip": "203.0.113.1",
        "x-forwarded-for": "198.51.100.2",
      },
    });
    expect(getClientIp(request)).toBe("203.0.113.1");
  });

  it("uses first x-forwarded-for value when cf header is missing", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "198.51.100.2, 203.0.113.9" },
    });
    expect(getClientIp(request)).toBe("198.51.100.2");
  });

  it("enforces fixed window rate limits", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const store = new Map<string, { windowStartMs: number; count: number }>();
    expect(checkFixedWindowRateLimit("k", store, { windowMs: 1000, maxCount: 2 })).toEqual({
      allowed: true,
    });
    expect(checkFixedWindowRateLimit("k", store, { windowMs: 1000, maxCount: 2 })).toEqual({
      allowed: true,
    });

    const third = checkFixedWindowRateLimit("k", store, { windowMs: 1000, maxCount: 2 });
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.retryAfterMs).toBeGreaterThan(0);

    vi.advanceTimersByTime(1000);
    expect(checkFixedWindowRateLimit("k", store, { windowMs: 1000, maxCount: 2 })).toEqual({
      allowed: true,
    });

    vi.useRealTimers();
  });
});
