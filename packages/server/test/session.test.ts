import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { verifySessionToken } from "../src/session.js";

describe("session token", () => {
  it("verifies payload fields", async () => {
    const secret = "x".repeat(64);
    const token = await new SignJWT({ login: "octocat", avatarUrl: "https://example.com/a.png" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject("123")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));

    await expect(verifySessionToken(token, { SESSION_SECRET: secret })).resolves.toEqual({
      githubUserId: "123",
      login: "octocat",
      avatarUrl: "https://example.com/a.png",
    });
  });
});
