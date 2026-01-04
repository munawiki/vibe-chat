import type { GithubUserId } from "@vscode-chat/protocol";
import { tryGetSocketUser } from "../socketAttachment.js";

export function countConnectionsForUser(
  webSockets: WebSocket[],
  githubUserId: GithubUserId,
): number {
  let count = 0;
  for (const ws of webSockets) {
    const user = tryGetSocketUser(ws);
    if (user?.githubUserId === githubUserId) count += 1;
  }
  return count;
}
