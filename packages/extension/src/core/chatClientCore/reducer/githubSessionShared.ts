import type { ChatClientCoreState } from "../types.js";

const SESSION_SKEW_MS = 30_000;

export function didGithubAccountChange(
  prevGithubAccountId: ChatClientCoreState["githubAccountId"],
  nextGithubAccountId: string,
): boolean {
  return Boolean(prevGithubAccountId && prevGithubAccountId !== nextGithubAccountId);
}

export function pickReusableCachedSession(options: {
  cachedSession: ChatClientCoreState["cachedSession"];
  githubAccountId: string;
  nowMs: number;
}): ChatClientCoreState["cachedSession"] | undefined {
  const cachedSession = options.cachedSession;
  if (!cachedSession) return undefined;
  if (cachedSession.githubAccountId !== options.githubAccountId) return undefined;
  if (cachedSession.expiresAtMs - SESSION_SKEW_MS <= options.nowMs) return undefined;
  return cachedSession;
}
