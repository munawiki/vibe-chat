import type { ChatClientCoreEvent, ChatClientCoreState, ChatClientState } from "../types.js";
import type { ReduceResult } from "./types.js";

export function handleWsWelcome(
  state: ChatClientCoreState,
  event: Extract<ChatClientCoreEvent, { type: "ws/welcome" }>,
): ReduceResult {
  if (state.publicState.authStatus !== "signedIn") return { state, commands: [] };

  const cachedSession = state.cachedSession
    ? { ...state.cachedSession, user: event.user }
    : state.cachedSession;

  const nextPublicState: ChatClientState =
    state.publicState.status === "connected" || state.publicState.status === "connecting"
      ? ({ ...state.publicState, user: event.user } satisfies ChatClientState)
      : state.publicState;

  return { state: { ...state, cachedSession, publicState: nextPublicState }, commands: [] };
}
