import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

const GithubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  avatar_url: z.string().url(),
});

type GithubUser = z.infer<typeof GithubUserSchema>;

const SessionTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  login: z.string().min(1),
  avatarUrl: z.string().url(),
});

const SESSION_TTL_SECONDS = 60 * 60; // 1h

export async function exchangeGithubTokenForSession(
  accessToken: string,
  env: { SESSION_SECRET: string },
): Promise<{
  token: string;
  expiresAt: string;
  user: { githubUserId: string; login: string; avatarUrl: string };
}> {
  const githubUser = await fetchGithubUser(accessToken);
  const user = {
    githubUserId: String(githubUser.id),
    login: githubUser.login,
    avatarUrl: githubUser.avatar_url,
  };

  const token = await createSessionToken(user, env);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  return { token, expiresAt, user };
}

export async function verifySessionToken(
  token: string,
  env: { SESSION_SECRET: string },
): Promise<{ githubUserId: string; login: string; avatarUrl: string }> {
  const secretKey = secret(env.SESSION_SECRET);
  const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });

  const parsed = SessionTokenPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("invalid_token_payload");
  }

  const { sub: githubUserId, login, avatarUrl } = parsed.data;
  return { githubUserId, login, avatarUrl };
}

async function createSessionToken(
  user: { githubUserId: string; login: string; avatarUrl: string },
  env: { SESSION_SECRET: string },
): Promise<string> {
  const secretKey = secret(env.SESSION_SECRET);

  return await new SignJWT({ login: user.login, avatarUrl: user.avatarUrl })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.githubUserId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey);
}

function secret(sessionSecret: string): Uint8Array {
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 chars");
  }
  return new TextEncoder().encode(sessionSecret);
}

async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "vscode-chat-worker",
    },
  });

  if (!response.ok) {
    throw new Error(`github_auth_failed_${response.status}`);
  }

  const json: unknown = await response.json();
  const parsed = GithubUserSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("github_user_schema_mismatch");
  }

  return parsed.data;
}
