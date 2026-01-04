import type { AuthUser } from "@vscode-chat/protocol";

/**
 * Durable Object WebSocket attachments are untyped at runtime.
 *
 * Why:
 * - `deserializeAttachment()` returns `unknown`.
 * - Most server code wants the authenticated `AuthUser` only.
 *
 * Invariants:
 * - Attachment shape is `{ user: AuthUser }` for all sockets accepted by the chat room.
 * - Attachment deserialization must be best-effort and must not throw.
 */

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
