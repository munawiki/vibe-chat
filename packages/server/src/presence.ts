import type { AuthUser, PresenceSnapshot } from "@vscode-chat/protocol";
import { tryGetSocketUser, type WebSocketLike } from "./socketAttachment.js";

export function derivePresenceSnapshotFromWebSockets(
  webSockets: WebSocketLike[],
  opts?: { exclude?: WebSocketLike | ReadonlySet<WebSocketLike> },
): PresenceSnapshot {
  const byUser = new Map<string, { user: AuthUser; connections: number }>();
  const exclude = opts?.exclude;

  for (const ws of webSockets) {
    if (exclude) {
      if (exclude instanceof Set) {
        if (exclude.has(ws)) continue;
      } else if (ws === exclude) {
        continue;
      }
    }

    const user = tryGetSocketUser(ws);
    if (!user) continue;

    const existing = byUser.get(user.githubUserId);
    if (existing) {
      existing.connections += 1;
      continue;
    }

    byUser.set(user.githubUserId, { user, connections: 1 });
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
