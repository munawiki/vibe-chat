import { describe, expect, it } from "vitest";
import { GitHubProfileService, githubProfileErrorToMessage } from "../src/net/githubProfile.js";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const OCTOCAT_PAYLOAD = {
  login: "octocat",
  id: 1,
  avatar_url: "https://example.com/a.png",
  html_url: "https://github.com/octocat",
} as const;

describe("GitHubProfileService", () => {
  it("rejects invalid logins", async () => {
    const svc = new GitHubProfileService({
      fetchImpl: () => Promise.reject(new Error("unexpected_fetch")),
    });

    const result = await svc.getProfile("not a login");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.type).toBe("invalid_login");
  });

  it("dedupes in-flight requests (case-insensitive)", async () => {
    let fetchCalls = 0;
    let resolveFetch: (value: Response) => void = () => {
      throw new Error("resolveFetch not set");
    };

    const fetchImpl: typeof fetch = async () => {
      fetchCalls += 1;
      return await new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    };

    const svc = new GitHubProfileService({ fetchImpl, ttlMs: 60_000, nowMs: () => 0 });
    const p1 = svc.getProfile("octocat");
    const p2 = svc.getProfile("OctoCat");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchCalls).toBe(1);
    resolveFetch(jsonResponse(OCTOCAT_PAYLOAD));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("expected profile");
    expect(r1.profile.githubUserId).toBe("1");

    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("expected profile");
    expect(r2.profile.githubUserId).toBe("1");
  });

  it("caches within ttl", async () => {
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = () => {
      fetchCalls += 1;
      return Promise.resolve(jsonResponse(OCTOCAT_PAYLOAD));
    };

    const svc = new GitHubProfileService({ fetchImpl, ttlMs: 60_000, nowMs: () => 0 });
    const r1 = await svc.getProfile("octocat");
    const r2 = await svc.getProfile("octocat");
    if (!r1.ok) throw new Error("expected profile");
    if (!r2.ok) throw new Error("expected profile");

    expect(fetchCalls).toBe(1);
  });

  it("refetches after ttl", async () => {
    let now = 0;
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = () => {
      fetchCalls += 1;
      return Promise.resolve(jsonResponse(OCTOCAT_PAYLOAD));
    };

    const svc = new GitHubProfileService({ fetchImpl, ttlMs: 1000, nowMs: () => now });
    const r1 = await svc.getProfile("octocat");
    if (!r1.ok) throw new Error("expected profile");
    now = 1001;
    const r2 = await svc.getProfile("octocat");
    if (!r2.ok) throw new Error("expected profile");

    expect(fetchCalls).toBe(2);
  });

  it("returns fetch_failed for non-ok responses", async () => {
    const svc = new GitHubProfileService({
      fetchImpl: () => Promise.resolve(new Response("forbidden", { status: 403 })),
    });

    const result = await svc.getProfile("octocat");
    expect(result).toEqual({ ok: false, error: { type: "fetch_failed", status: 403 } });
    if (result.ok) throw new Error("expected error");
    expect(githubProfileErrorToMessage(result.error)).toBe("github_profile_fetch_failed_403");
  });

  it("returns invalid_json for malformed response body", async () => {
    const svc = new GitHubProfileService({
      fetchImpl: () =>
        Promise.resolve(
          new Response("{", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    });

    const result = await svc.getProfile("octocat");
    expect(result).toEqual({ ok: false, error: { type: "invalid_json" } });
  });

  it("returns schema_mismatch for unsupported payload shape", async () => {
    const svc = new GitHubProfileService({
      fetchImpl: () =>
        Promise.resolve(
          jsonResponse({
            login: "octocat",
            id: "not-a-number",
            avatar_url: "https://example.com/a.png",
            html_url: "https://github.com/octocat",
          }),
        ),
    });

    const result = await svc.getProfile("octocat");
    expect(result).toEqual({ ok: false, error: { type: "schema_mismatch" } });
  });

  it("adds authorization and user-agent headers when access token exists", async () => {
    const fetchImpl = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(init?.headers).toMatchObject({
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "custom-agent",
        authorization: "Bearer token-123",
      });
      return Promise.resolve(jsonResponse(OCTOCAT_PAYLOAD));
    };

    const svc = new GitHubProfileService({
      fetchImpl,
      userAgent: "custom-agent",
      getAccessToken: () => Promise.resolve("token-123"),
    });

    const result = await svc.getProfile("octocat");
    expect(result.ok).toBe(true);
  });

  it("maps blank network error messages to fallback key", async () => {
    const svc = new GitHubProfileService({
      fetchImpl: () => Promise.reject(new Error("   ")),
    });

    const result = await svc.getProfile("octocat");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.type).toBe("network_error");
    expect(githubProfileErrorToMessage(result.error)).toBe("github_profile_network_error");
  });

  it("maps optional github profile fields when provided", async () => {
    const svc = new GitHubProfileService({
      fetchImpl: () =>
        Promise.resolve(
          jsonResponse({
            login: "octocat",
            id: 1,
            avatar_url: "https://example.com/a.png",
            html_url: "https://github.com/octocat",
            name: "The Octocat",
            bio: "bio",
            company: "@github",
            location: "SF",
            blog: "https://blog.example.test",
            twitter_username: "octo",
            public_repos: 10,
            followers: 20,
            following: 30,
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-02T00:00:00.000Z",
          }),
        ),
    });

    const result = await svc.getProfile("octocat");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected profile");
    expect(result.profile).toMatchObject({
      name: "The Octocat",
      bio: "bio",
      company: "@github",
      location: "SF",
      blog: "https://blog.example.test",
      twitterUsername: "octo",
      publicRepos: 10,
      followers: 20,
      following: 30,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-02T00:00:00.000Z",
    });
  });

  it("maps each profile error type to a stable message key", () => {
    expect(githubProfileErrorToMessage({ type: "invalid_login" })).toBe(
      "github_profile_invalid_login",
    );
    expect(githubProfileErrorToMessage({ type: "invalid_json" })).toBe(
      "github_profile_invalid_json",
    );
    expect(githubProfileErrorToMessage({ type: "schema_mismatch" })).toBe(
      "github_profile_schema_mismatch",
    );
    expect(
      githubProfileErrorToMessage({
        type: "network_error",
        cause: { message: "opaque" },
      }),
    ).toBe("[object Object]");
    expect(
      githubProfileErrorToMessage({
        type: "network_error",
        cause: new Error("network down"),
      }),
    ).toBe("network down");
  });
});
