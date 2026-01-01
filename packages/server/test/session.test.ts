import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { verifySessionToken } from "../src/session.js";

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
});
