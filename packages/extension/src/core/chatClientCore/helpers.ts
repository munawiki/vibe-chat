import type { ChatClientCoreState, ChatClientState } from "./types.js";

/**
 * Invariant: the core state machine is a pure transition system.
 * This module MUST remain side-effect-free and deterministic.
 */

type SignedOutDisconnectedState = Extract<
  ChatClientState,
  { authStatus: "signedOut"; status: "disconnected" }
>;

export const initialChatClientCoreState = (): ChatClientCoreState => ({
  publicState: { authStatus: "signedOut", status: "disconnected" },
  githubAccountId: undefined,
  cachedSession: undefined,
  reconnectAttempt: 0,
  reconnectScheduled: false,
  pending: undefined,
});

export function computeReconnectDelayMs(attempt: number): number {
  const exponent = Math.min(attempt, 6);
  return Math.min(30_000, 500 * Math.pow(2, exponent));
}

export function toSignedOutDisconnected(
  prev: ChatClientState,
  backendUrl?: string,
): SignedOutDisconnectedState {
  const previousBackendUrl = backendUrl ?? prev.backendUrl;
  return previousBackendUrl
    ? { authStatus: "signedOut", status: "disconnected", backendUrl: previousBackendUrl }
    : { authStatus: "signedOut", status: "disconnected" };
}

export function assertNever(x: never): never {
  throw new Error(`unreachable: ${JSON.stringify(x)}`);
}
