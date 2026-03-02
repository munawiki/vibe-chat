import { z } from "zod";
import { GithubUserIdSchema } from "@vscode-chat/protocol";
import {
  GitHubProfileMetaSchema,
  type GitHubProfile,
} from "../../contract/githubProfile.js";

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

export type GitHubProfileError =
  | { type: "invalid_login" }
  | { type: "fetch_failed"; status: number }
  | { type: "invalid_json" }
  | { type: "schema_mismatch" }
  | { type: "network_error"; cause: unknown };

export type GitHubProfileResult =
  | { ok: true; profile: GitHubProfile }
  | { ok: false; error: GitHubProfileError };

function assignIfDefined<Key extends keyof GitHubProfile>(
  profile: GitHubProfile,
  key: Key,
  value: GitHubProfile[Key] | undefined,
): void {
  if (value !== undefined) {
    profile[key] = value;
  }
}

function buildProfile(
  base: GitHubProfile,
  api: z.infer<typeof GitHubUserApiResponseSchema>,
): GitHubProfile {
  const profile: GitHubProfile = { ...base };
  assignIfDefined(profile, "name", api.name);
  assignIfDefined(profile, "bio", api.bio);
  assignIfDefined(profile, "company", api.company);
  assignIfDefined(profile, "location", api.location);
  assignIfDefined(profile, "blog", api.blog);
  assignIfDefined(profile, "twitterUsername", api.twitter_username);
  assignIfDefined(profile, "publicRepos", api.public_repos);
  assignIfDefined(profile, "followers", api.followers);
  assignIfDefined(profile, "following", api.following);
  assignIfDefined(profile, "createdAt", api.created_at);
  assignIfDefined(profile, "updatedAt", api.updated_at);
  return profile;
}

export async function fetchGitHubProfile(options: {
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
  } catch (error_: unknown) {
    return { ok: false, error: { type: "network_error", cause: error_ } };
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
    profile: buildProfile(base, api),
  };
}
