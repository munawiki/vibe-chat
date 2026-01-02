import type { AuthUser, PresenceSnapshot } from "@vscode-chat/protocol";

type SocketAttachment = {
  user: AuthUser;
};

type WebSocketLike = {
  deserializeAttachment: () => unknown;
};

export function derivePresenceSnapshotFromWebSockets(
  webSockets: WebSocketLike[],
  opts?: { exclude?: WebSocketLike },
): PresenceSnapshot {
  const byUser = new Map<string, { user: AuthUser; connections: number }>();

  for (const ws of webSockets) {
    if (opts?.exclude && ws === opts.exclude) continue;

    try {
      const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
      const user = attachment?.user;
      if (!user) continue;

      const existing = byUser.get(user.githubUserId);
      if (existing) {
        existing.connections += 1;
        continue;
      }

      byUser.set(user.githubUserId, { user, connections: 1 });
    } catch {
      // ignore
    }
  }

  const snapshot = [...byUser.values()];
  snapshot.sort((a, b) => {
    if (a.user.login !== b.user.login) return a.user.login < b.user.login ? -1 : 1;
    if (a.user.githubUserId !== b.user.githubUserId) {
      return a.user.githubUserId < b.user.githubUserId ? -1 : 1;
    }
    return 0;
  });
  return snapshot;
}
