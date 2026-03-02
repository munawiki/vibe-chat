import type { AuthUser, PresenceSnapshot } from "@vscode-chat/protocol";
import { tryGetSocketUser, type WebSocketLike } from "./socketAttachment.js";

function isExcludedSocket(
  ws: WebSocketLike,
  exclude?: WebSocketLike | ReadonlySet<WebSocketLike>,
): boolean {
  if (exclude instanceof Set) return exclude.has(ws);
  return exclude ? ws === exclude : false;
}

function trackActiveUser(
  byUser: Map<string, { user: AuthUser; connections: number }>,
  user: AuthUser,
): void {
  const existing = byUser.get(user.githubUserId);
  if (!existing) {
    byUser.set(user.githubUserId, { user, connections: 1 });
    return;
  }
  existing.connections += 1;
}

export function collectActiveUsers(
  webSockets: WebSocketLike[],
  opts?: { exclude?: WebSocketLike | ReadonlySet<WebSocketLike> },
): Map<string, { user: AuthUser; connections: number }> {
  const byUser = new Map<string, { user: AuthUser; connections: number }>();
  const exclude = opts?.exclude;

  for (const ws of webSockets) {
    if (isExcludedSocket(ws, exclude)) continue;

    const user = tryGetSocketUser(ws);
    if (!user) continue;
    trackActiveUser(byUser, user);
  }

  return byUser;
}

export function derivePresenceSnapshotFromWebSockets(
  webSockets: WebSocketLike[],
  opts?: { exclude?: WebSocketLike | ReadonlySet<WebSocketLike> },
): PresenceSnapshot {
  const snapshot = [...collectActiveUsers(webSockets, opts).values()];
  snapshot.sort((a, b) => {
    if (a.user.login !== b.user.login) return a.user.login < b.user.login ? -1 : 1;
    if (a.user.githubUserId !== b.user.githubUserId) {
      return a.user.githubUserId < b.user.githubUserId ? -1 : 1;
    }
    return 0;
  });
  return snapshot;
}
