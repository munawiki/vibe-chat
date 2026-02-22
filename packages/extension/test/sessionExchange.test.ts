import { afterEach, describe, expect, it, vi } from "vitest";
import type { GithubUserId } from "@vscode-chat/protocol";
import { exchangeSession } from "../src/adapters/sessionExchange.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exchangeSession", () => {
  it("returns network_error when fetch throws", async () => {
    vi.stubGlobal("fetch", (() => {
      throw new Error("boom");
    }) as unknown as typeof fetch);

    const result = await exchangeSession("https://example.test", "t");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("network_error");
  });

  it("returns http error for non-2xx responses", async () => {
    vi.stubGlobal("fetch", (() =>
      Promise.resolve(new Response("no", { status: 401 }))) as unknown as typeof fetch);

    const result = await exchangeSession("https://example.test", "t");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("http");
      if (result.error.type === "http") expect(result.error.status).toBe(401);
    }
  });

  it("returns invalid_response for invalid json or schema mismatch", async () => {
    vi.stubGlobal("fetch", (() =>
      Promise.resolve(new Response("not json", { status: 200 }))) as unknown as typeof fetch);
    const badJson = await exchangeSession("https://example.test", "t");
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) expect(badJson.error.type).toBe("invalid_response");

    vi.stubGlobal("fetch", (() =>
      Promise.resolve(
        new Response(JSON.stringify({ token: "t" }), { status: 200 }),
      )) as unknown as typeof fetch);
    const schemaMismatch = await exchangeSession("https://example.test", "t");
    expect(schemaMismatch.ok).toBe(false);
    if (!schemaMismatch.ok) expect(schemaMismatch.error.type).toBe("invalid_response");
  });

  it("returns invalid_response when expiresAt is not parseable", async () => {
    vi.stubGlobal("fetch", (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            token: "token",
            expiresAt: "not-a-date",
            user: {
              githubUserId: "1",
              login: "alice",
              avatarUrl: "https://example.test/alice.png",
            },
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch);

    const result = await exchangeSession("https://example.test", "t");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("invalid_response");
  });

  it("parses a valid session exchange response", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    vi.stubGlobal("fetch", (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            token: "token",
            expiresAt,
            user: {
              githubUserId: "1",
              login: "alice",
              avatarUrl: "https://example.test/alice.png",
            },
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch);

    const result = await exchangeSession("https://example.test", "t");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.token).toBe("token");
      expect(result.session.user.githubUserId).toBe("1" as GithubUserId);
      expect(Number.isFinite(result.session.expiresAtMs)).toBe(true);
    }
  });
});
