import { GithubUserIdSchema, type GithubUserId } from "@vscode-chat/protocol";

export function parseGithubUserIdList(
  value: string | undefined,
  options?: { key?: string },
): Set<GithubUserId> {
  return parseGithubUserIdListInternal(value, options?.key);
}

export function parseGithubUserIdDenylist(value: string | undefined): Set<GithubUserId> {
  return parseGithubUserIdList(value, { key: "DENY_GITHUB_USER_IDS" });
}

function parseGithubUserIdListInternal(value: string | undefined, key?: string): Set<GithubUserId> {
  if (!value) return new Set();

  const parts = value
    .split(/[,\n]/g)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const ids = new Set<GithubUserId>();
  for (const id of parts) {
    const parsed = GithubUserIdSchema.safeParse(id);
    if (!parsed.success) {
      const label = key ?? "GitHub user id list";
      throw new Error(`${label} must be a comma-separated list of GitHub numeric user ids.`);
    }
    ids.add(parsed.data);
  }

  return ids;
}
