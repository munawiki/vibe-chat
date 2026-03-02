import { GitHubLoginSchema, type GitHubProfile } from "../../contract/githubProfile.js";
import { fetchGitHubProfile, type GitHubProfileResult } from "./fetch.js";

export type GitHubProfileServiceOptions = {
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  getAccessToken?: () => Promise<string | undefined>;
  userAgent?: string;
};

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
