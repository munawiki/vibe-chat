import type { ChatClientCoreEvent, ChatClientCoreState, ChatClientState } from "../types.js";
import type { ReduceResult } from "./types.js";

export function handleAuthRefreshRequested(
  state: ChatClientCoreState,
  _event: Extract<ChatClientCoreEvent, { type: "auth/refresh.requested" }>,
): ReduceResult {
  return {
    state: { ...state, pending: { type: "pending/auth", interactive: false } },
    commands: [{ type: "cmd/github.session.get", interactive: false }],
  };
}

export function handleUiSignIn(
  state: ChatClientCoreState,
  _event: Extract<ChatClientCoreEvent, { type: "ui/signIn" }>,
): ReduceResult {
  return {
    state: { ...state, pending: { type: "pending/auth", interactive: true } },
    commands: [{ type: "cmd/github.session.get", interactive: true }],
  };
}

export function handleUiConnect(
  state: ChatClientCoreState,
  event: Extract<ChatClientCoreEvent, { type: "ui/connect" }>,
): ReduceResult {
  const nextPublicState =
    event.interactive && state.publicState.status !== "connecting"
      ? ({
          ...state.publicState,
          backendUrl: event.backendUrl,
          status: "connecting",
        } satisfies ChatClientState)
      : state.publicState;

  return {
    state: {
      ...state,
      publicState: nextPublicState,
      pending: {
        type: "pending/connect.session",
        origin: event.origin,
        backendUrl: event.backendUrl,
        interactive: event.interactive,
      },
      reconnectScheduled: false,
    },
    commands: [
      { type: "cmd/reconnect.cancel" },
      { type: "cmd/github.session.get", interactive: event.interactive },
    ],
  };
}

export function handleUiDisconnect(
  state: ChatClientCoreState,
  _event: Extract<ChatClientCoreEvent, { type: "ui/disconnect" }>,
): ReduceResult {
  const nextPublicState = {
    ...state.publicState,
    status: "disconnected",
  } satisfies ChatClientState;
  return {
    state: {
      ...state,
      publicState: nextPublicState,
      pending: undefined,
      reconnectScheduled: false,
    },
    commands: [
      { type: "cmd/reconnect.cancel" },
      { type: "cmd/ws.close", code: 1000, reason: "client_disconnect" },
    ],
  };
}
