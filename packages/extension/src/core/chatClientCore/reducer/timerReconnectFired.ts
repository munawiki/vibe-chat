import type { ChatClientCoreEvent, ChatClientCoreState } from "../types.js";
import type { ReduceResult } from "./types.js";
import { handleUiConnect } from "./ui.js";

export function handleTimerReconnectFired(
  state: ChatClientCoreState,
  event: Extract<ChatClientCoreEvent, { type: "timer/reconnect.fired" }>,
): ReduceResult {
  if (state.publicState.authStatus !== "signedIn") {
    return { state: { ...state, reconnectScheduled: false }, commands: [] };
  }

  return handleUiConnect(
    { ...state, reconnectScheduled: false },
    { type: "ui/connect", origin: "reconnect", backendUrl: event.backendUrl, interactive: false },
  );
}
