import type { AuthUser, GithubUserId } from "@vscode-chat/protocol";

export function isModerator(user: AuthUser): boolean {
  return user.roles.includes("moderator");
}

export function isOperatorDenied(
  operatorDeniedGithubUserIds: ReadonlySet<GithubUserId>,
  githubUserId: GithubUserId,
): boolean {
  return operatorDeniedGithubUserIds.has(githubUserId);
}

export function isDenied(options: {
  operatorDeniedGithubUserIds: ReadonlySet<GithubUserId>;
  roomDeniedGithubUserIds: ReadonlySet<GithubUserId>;
  githubUserId: GithubUserId;
}): boolean {
  return (
    isOperatorDenied(options.operatorDeniedGithubUserIds, options.githubUserId) ||
    options.roomDeniedGithubUserIds.has(options.githubUserId)
  );
}
