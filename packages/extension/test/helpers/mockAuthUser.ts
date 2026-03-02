import type { AuthUser, GithubUserId } from "@vscode-chat/protocol";

export function createMockAuthUser(options?: {
  githubUserId?: string;
  login?: string;
  avatarUrl?: string;
  roles?: AuthUser["roles"];
}): AuthUser {
  const githubUserId = (options?.githubUserId ?? "1") as GithubUserId;
  const login = options?.login ?? `user-${githubUserId}`;
  return {
    githubUserId,
    login,
    avatarUrl: options?.avatarUrl ?? `https://example.test/${login}.png`,
    roles: options?.roles ?? [],
  };
}
