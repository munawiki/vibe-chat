import { z } from "zod";
import { GithubUserIdSchema } from "@vscode-chat/protocol";
import {
  GitHubLoginSchema,
  GitHubProfileMetaSchema,
  type GitHubProfile,
} from "../contract/githubProfile.js";

export {
  GitHubLoginSchema,
  GitHubProfileMetaSchema,
  GitHubProfileSchema,
} from "../contract/githubProfile.js";
export type { GitHubProfile } from "../contract/githubProfile.js";

const GitHubUserApiResponseSchema = GitHubProfileMetaSchema.merge(
  z.object({
    login: z.string().min(1),
    id: z.number().int().positive(),
    avatar_url: z.string().url(),
    html_url: z.string().url(),

    twitter_username: z.string().nullable().optional(),

    public_repos: z.number().int().nonnegative().optional(),
    followers: z.number().int().nonnegative().optional(),
    following: z.number().int().nonnegative().optional(),

    created_at: z.string().datetime().optional(),
    updated_at: z.string().datetime().optional(),
  }),
);

export type GitHubProfileServiceOptions = {
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  getAccessToken?: () => Promise<string | undefined>;
  userAgent?: string;
};

export type GitHubProfileError =
  | { type: "invalid_login" }
  | { type: "fetch_failed"; status: number }
  | { type: "invalid_json" }
  | { type: "schema_mismatch" }
  | { type: "network_error"; cause: unknown };

export type GitHubProfileResult =
  | { ok: true; profile: GitHubProfile }
  | { ok: false; error: GitHubProfileError };

export function githubProfileErrorToMessage(error: GitHubProfileError): string {
  switch (error.type) {
    case "invalid_login":
      return "github_profile_invalid_login";
    case "fetch_failed":
      return `github_profile_fetch_failed_${error.status}`;
    case "invalid_json":
      return "github_profile_invalid_json";
    case "schema_mismatch":
      return "github_profile_schema_mismatch";
    case "network_error": {
      const msg = error.cause instanceof Error ? error.cause.message : String(error.cause);
      const trimmed = msg.trim();
      return trimmed.length > 0 ? trimmed : "github_profile_network_error";
    }
  }
}

export class GitHubProfileService {
  private readonly ttlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;
  private readonly getAccessToken: () => Promise<string | undefined>;
  private readonly userAgent: string;

  private readonly cache = new Map<string, { profile: GitHubProfile; fetchedAtMs: number }>();
  private readonly inFlight = new Map<string, Promise<GitHubProfileResult>>();

  constructor(options: GitHubProfileServiceOptions = {}) {
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.getAccessToken = options.getAccessToken ?? (() => Promise.resolve(undefined));
    this.userAgent = options.userAgent ?? "vscode-chat-extension";
  }

  async getProfile(login: string): Promise<GitHubProfileResult> {
    const parsedLogin = GitHubLoginSchema.safeParse(login);
    if (!parsedLogin.success) {
      return { ok: false, error: { type: "invalid_login" } };
    }

    const key = parsedLogin.data.toLowerCase();
    const cached = this.cache.get(key);
    if (cached && this.nowMs() - cached.fetchedAtMs <= this.ttlMs) {
      return { ok: true, profile: cached.profile };
    }

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = this.fetchAndCache(key).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async fetchAndCache(login: string): Promise<GitHubProfileResult> {
    const token = await this.getAccessToken().catch(() => undefined);
    const result = await fetchGitHubProfile({
      fetchImpl: this.fetchImpl,
      login,
      accessToken: token,
      userAgent: this.userAgent,
    });

    if (result.ok) {
      this.cache.set(login, { profile: result.profile, fetchedAtMs: this.nowMs() });
    }
    return result;
  }
}

async function fetchGitHubProfile(options: {
  fetchImpl: typeof fetch;
  login: string;
  accessToken: string | undefined;
  userAgent: string;
}): Promise<GitHubProfileResult> {
  const url = `https://api.github.com/users/${encodeURIComponent(options.login)}`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": options.userAgent,
  };
  if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;

  let response: Response;
  try {
    response = await options.fetchImpl(url, { headers });
  } catch (cause: unknown) {
    return { ok: false, error: { type: "network_error", cause } };
  }

  if (!response.ok) return { ok: false, error: { type: "fetch_failed", status: response.status } };

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, error: { type: "invalid_json" } };
  }

  const parsed = GitHubUserApiResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: { type: "schema_mismatch" } };
  }

  const api = parsed.data;
  const githubUserId = GithubUserIdSchema.parse(String(api.id));
  const base: GitHubProfile = {
    login: api.login,
    githubUserId,
    avatarUrl: api.avatar_url,
    htmlUrl: api.html_url,
  };

  return {
    ok: true,
    profile: {
      ...base,
      ...(api.name !== undefined ? { name: api.name } : {}),
      ...(api.bio !== undefined ? { bio: api.bio } : {}),
      ...(api.company !== undefined ? { company: api.company } : {}),
      ...(api.location !== undefined ? { location: api.location } : {}),
      ...(api.blog !== undefined ? { blog: api.blog } : {}),
      ...(api.twitter_username !== undefined ? { twitterUsername: api.twitter_username } : {}),
      ...(api.public_repos !== undefined ? { publicRepos: api.public_repos } : {}),
      ...(api.followers !== undefined ? { followers: api.followers } : {}),
      ...(api.following !== undefined ? { following: api.following } : {}),
      ...(api.created_at !== undefined ? { createdAt: api.created_at } : {}),
      ...(api.updated_at !== undefined ? { updatedAt: api.updated_at } : {}),
    },
  };
}
