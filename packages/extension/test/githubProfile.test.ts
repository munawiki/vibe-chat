import { describe, expect, it } from "vitest";
import { GitHubProfileService } from "../src/net/githubProfile.js";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHubProfileService", () => {
  it("rejects invalid logins", async () => {
    const svc = new GitHubProfileService({
      fetchImpl: () => Promise.reject(new Error("unexpected_fetch")),
    });

    await expect(svc.getProfile("not a login")).rejects.toThrow("github_profile_invalid_login");
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
    resolveFetch(
      jsonResponse({
        login: "octocat",
        id: 1,
        avatar_url: "https://example.com/a.png",
        html_url: "https://github.com/octocat",
      }),
    );

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.githubUserId).toBe("1");
    expect(r2.githubUserId).toBe("1");
  });

  it("caches within ttl", async () => {
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = () => {
      fetchCalls += 1;
      return Promise.resolve(
        jsonResponse({
          login: "octocat",
          id: 1,
          avatar_url: "https://example.com/a.png",
          html_url: "https://github.com/octocat",
        }),
      );
    };

    const svc = new GitHubProfileService({ fetchImpl, ttlMs: 60_000, nowMs: () => 0 });
    await svc.getProfile("octocat");
    await svc.getProfile("octocat");

    expect(fetchCalls).toBe(1);
  });

  it("refetches after ttl", async () => {
    let now = 0;
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = () => {
      fetchCalls += 1;
      return Promise.resolve(
        jsonResponse({
          login: "octocat",
          id: 1,
          avatar_url: "https://example.com/a.png",
          html_url: "https://github.com/octocat",
        }),
      );
    };

    const svc = new GitHubProfileService({ fetchImpl, ttlMs: 1000, nowMs: () => now });
    await svc.getProfile("octocat");
    now = 1001;
    await svc.getProfile("octocat");

    expect(fetchCalls).toBe(2);
  });
});
