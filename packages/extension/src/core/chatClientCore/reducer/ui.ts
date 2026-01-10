import { toSignedOutDisconnected } from "../helpers.js";
import type { ChatClientCoreEvent, ChatClientCoreState, ChatClientState } from "../types.js";
import type { ReduceResult } from "./types.js";

export function handleAuthRefreshRequested(
  state: ChatClientCoreState,
  _event: Extract<ChatClientCoreEvent, { type: "auth/refresh.requested" }>,
): ReduceResult {
  if (state.authSuppressedByUser) {
    const nextPublicState = toSignedOutDisconnected(state.publicState);
    return {
      state: {
        ...state,
        publicState: nextPublicState,
        githubAccountId: undefined,
        cachedSession: undefined,
        pending: undefined,
        reconnectAttempt: 0,
        reconnectScheduled: false,
      },
      commands: [
        { type: "cmd/reconnect.cancel" },
        { type: "cmd/ws.close", code: 1000, reason: "auth_suppressed" },
      ],
    };
  }
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
    commands: [
      {
        type: "cmd/github.session.get",
        interactive: true,
        ...(state.clearSessionPreferenceOnNextSignIn ? { clearSessionPreference: true } : {}),
      },
    ],
  };
}

export function handleUiConnect(
  state: ChatClientCoreState,
  event: Extract<ChatClientCoreEvent, { type: "ui/connect" }>,
): ReduceResult {
  if (!event.interactive && state.authSuppressedByUser) {
    return { state: { ...state, pending: undefined }, commands: [] };
  }
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
      {
        type: "cmd/github.session.get",
        interactive: event.interactive,
        ...(event.interactive && state.clearSessionPreferenceOnNextSignIn
          ? { clearSessionPreference: true }
          : {}),
      },
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

export function handleUiSignOut(
  state: ChatClientCoreState,
  _event: Extract<ChatClientCoreEvent, { type: "ui/signOut" }>,
): ReduceResult {
  return {
    state: {
      ...state,
      publicState: toSignedOutDisconnected(state.publicState),
      githubAccountId: undefined,
      cachedSession: undefined,
      authSuppressedByUser: true,
      clearSessionPreferenceOnNextSignIn: true,
      pending: undefined,
      reconnectAttempt: 0,
      reconnectScheduled: false,
    },
    commands: [
      { type: "cmd/reconnect.cancel" },
      { type: "cmd/ws.close", code: 1000, reason: "user_signout" },
    ],
  };
}
