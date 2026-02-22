import type { AuthUser } from "@vscode-chat/protocol";

export type SocketAttachment = {
  user: AuthUser;
};

export type WebSocketLike = {
  deserializeAttachment: () => unknown;
};

export function tryGetSocketUser(ws: WebSocketLike): AuthUser | undefined {
  try {
    const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
    return attachment?.user;
  } catch {
    return undefined;
  }
}
