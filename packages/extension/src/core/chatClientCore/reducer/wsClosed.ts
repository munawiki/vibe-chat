import { computeReconnectDelayMs } from "../helpers.js";
import type { ChatClientCoreEvent, ChatClientCoreState, ChatClientState } from "../types.js";
import type { ReduceResult } from "./types.js";

export function handleWsClosed(
  state: ChatClientCoreState,
  event: Extract<ChatClientCoreEvent, { type: "ws/closed" }>,
): ReduceResult {
  const signedIn = state.publicState.authStatus === "signedIn";
  const nextPublicState = {
    ...state.publicState,
    status: "disconnected",
  } satisfies ChatClientState;

  if (!signedIn || !event.autoReconnectEnabled || state.reconnectScheduled) {
    return { state: { ...state, publicState: nextPublicState }, commands: [] };
  }

  const attempt = state.reconnectAttempt;
  const delayMs = computeReconnectDelayMs(attempt);

  return {
    state: {
      ...state,
      publicState: nextPublicState,
      reconnectAttempt: attempt + 1,
      reconnectScheduled: true,
    },
    commands: [
      {
        type: "cmd/telemetry.send",
        event: { name: "vscodeChat.ws.reconnect_scheduled", attempt, delayMs },
      },
      { type: "cmd/reconnect.schedule", delayMs },
    ],
  };
}
