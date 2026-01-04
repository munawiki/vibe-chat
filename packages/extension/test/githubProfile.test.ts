import { describe, expect, it } from "vitest";
import { GitHubProfileService } from "../src/net/githubProfile.js";

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
});
