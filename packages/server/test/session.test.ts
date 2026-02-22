import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { exchangeGithubTokenForSession, verifySessionToken } from "../src/session.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const secret = "x".repeat(64);
const secretKey = new TextEncoder().encode(secret);

async function signToken(options: {
  login: string;
  avatarUrl: string;
  githubUserId?: string;
}): Promise<string> {
  const jwt = new SignJWT({ login: options.login, avatarUrl: options.avatarUrl })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("1h");

  if (options.githubUserId) jwt.setSubject(options.githubUserId);
  return await jwt.sign(secretKey);
}

describe("session token", () => {
  it("rejects when SESSION_SECRET is too short", async () => {
    await expect(verifySessionToken("x", { SESSION_SECRET: "short" })).rejects.toThrow(
      "SESSION_SECRET must be at least 32 chars",
    );
  });

  it("verifies payload fields", async () => {
    const token = await signToken({
      login: "octocat",
      avatarUrl: "https://example.com/a.png",
      githubUserId: "123",
    });

    await expect(verifySessionToken(token, { SESSION_SECRET: secret })).resolves.toEqual({
      githubUserId: "123",
      login: "octocat",
      avatarUrl: "https://example.com/a.png",
    });
  });

  it("rejects when avatarUrl is invalid", async () => {
    const token = await signToken({
      login: "octocat",
      avatarUrl: "not-a-url",
      githubUserId: "123",
    });

    await expect(verifySessionToken(token, { SESSION_SECRET: secret })).rejects.toThrow(
      "invalid_token_payload",
    );
  });

  it("rejects when subject is missing", async () => {
    const token = await signToken({ login: "octocat", avatarUrl: "https://example.com/a.png" });

    await expect(verifySessionToken(token, { SESSION_SECRET: secret })).rejects.toThrow(
      "invalid_token_payload",
    );
  });

  it("exchanges a GitHub access token for a signed session token", async () => {
    vi.stubGlobal("fetch", (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 123,
            login: "octocat",
            avatar_url: "https://example.com/a.png",
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch);

    const result = await exchangeGithubTokenForSession("gh", { SESSION_SECRET: secret });
    expect(result.user).toEqual({
      githubUserId: "123",
      login: "octocat",
      avatarUrl: "https://example.com/a.png",
    });

    await expect(verifySessionToken(result.token, { SESSION_SECRET: secret })).resolves.toEqual(
      result.user,
    );
    expect(Number.isFinite(Date.parse(result.expiresAt))).toBe(true);
  });

  it("rejects when GitHub API returns non-2xx", async () => {
    vi.stubGlobal("fetch", (() =>
      Promise.resolve(new Response("no", { status: 401 }))) as unknown as typeof fetch);

    await expect(exchangeGithubTokenForSession("gh", { SESSION_SECRET: secret })).rejects.toThrow(
      "github_auth_failed_401",
    );
  });

  it("rejects when GitHub user response schema mismatches", async () => {
    vi.stubGlobal("fetch", (() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: -1, login: "", avatar_url: "not-a-url" }), {
          status: 200,
        }),
      )) as unknown as typeof fetch);

    await expect(exchangeGithubTokenForSession("gh", { SESSION_SECRET: secret })).rejects.toThrow(
      "github_user_schema_mismatch",
    );
  });
});
