import { describe, expect, it, vi } from "vitest";
import {
  checkFixedWindowRateLimit,
  evictOldestEntries,
  pruneExpiredFixedWindowEntries,
  boundFixedWindowRateLimitStore,
  getClientIp,
  parseBearerToken,
  parseGithubUserIdDenylist,
  readRequestJsonWithLimit,
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
    expect(() => parseGithubUserIdDenylist("1,abc")).toThrow();
  });

  it("reads JSON request bodies with a size limit", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });

    const result = await readRequestJsonWithLimit(request, { maxBytes: 1024, timeoutMs: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.json).toEqual({ ok: true });
  });

  it("rejects oversized JSON bodies by content-length header", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      headers: { "content-length": "1000" },
      body: JSON.stringify({ ok: true }),
    });

    const result = await readRequestJsonWithLimit(request, { maxBytes: 10, timeoutMs: 1000 });
    expect(result).toEqual({ ok: false, error: "too_large" });
  });

  it("rejects invalid JSON bodies", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });

    const result = await readRequestJsonWithLimit(request, { maxBytes: 1024, timeoutMs: 1000 });
    expect(result).toEqual({ ok: false, error: "invalid_json" });
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
    expect(
      checkFixedWindowRateLimit("k", store, { windowMs: 1000, maxCount: 2, maxTrackedKeys: 100 }),
    ).toEqual({
      allowed: true,
    });
    expect(
      checkFixedWindowRateLimit("k", store, { windowMs: 1000, maxCount: 2, maxTrackedKeys: 100 }),
    ).toEqual({
      allowed: true,
    });

    const third = checkFixedWindowRateLimit("k", store, {
      windowMs: 1000,
      maxCount: 2,
      maxTrackedKeys: 100,
    });
    expect(third.allowed).toBe(false);
    if (!third.allowed) expect(third.retryAfterMs).toBeGreaterThan(0);

    vi.advanceTimersByTime(1000);
    expect(
      checkFixedWindowRateLimit("k", store, { windowMs: 1000, maxCount: 2, maxTrackedKeys: 100 }),
    ).toEqual({
      allowed: true,
    });

    vi.useRealTimers();
  });

  it("prunes expired fixed-window entries", () => {
    const store = new Map<string, { windowStartMs: number; count: number }>([
      ["a", { windowStartMs: 0, count: 1 }],
      ["b", { windowStartMs: 1500, count: 1 }],
      ["c", { windowStartMs: 1999, count: 1 }],
    ]);

    pruneExpiredFixedWindowEntries(store, 2000, 1000);

    expect([...store.keys()]).toEqual(["b", "c"]);
  });

  it("evicts oldest entries when maxTrackedKeys is exceeded", () => {
    const store = new Map<string, { windowStartMs: number; count: number }>([
      ["a", { windowStartMs: 0, count: 1 }],
      ["b", { windowStartMs: 0, count: 1 }],
      ["c", { windowStartMs: 0, count: 1 }],
    ]);

    evictOldestEntries(store, 2);

    expect([...store.keys()]).toEqual(["b", "c"]);
  });

  it("bounds stores by pruning and eviction", () => {
    const store = new Map<string, { windowStartMs: number; count: number }>([
      ["expired", { windowStartMs: 0, count: 1 }],
      ["a", { windowStartMs: 1500, count: 1 }],
      ["b", { windowStartMs: 1500, count: 1 }],
      ["c", { windowStartMs: 1500, count: 1 }],
    ]);

    boundFixedWindowRateLimitStore(store, 2000, { windowMs: 1000, maxTrackedKeys: 2 });

    expect([...store.keys()]).toEqual(["b", "c"]);
  });
});
