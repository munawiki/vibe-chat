import type { ChatClientCoreCommand, ChatClientCoreEvent, ChatClientCoreState } from "../types.js";
import type { ReduceResult } from "./types.js";
import { handleHandshake429Failure } from "./wsOpenResult429.js";

type PendingConnectWs = Extract<ChatClientCoreState["pending"], { type: "pending/connect.ws" }>;

function toDisconnectedState(state: ChatClientCoreState): ChatClientCoreState {
  return {
    ...state,
    publicState: { ...state.publicState, status: "disconnected" },
    pending: undefined,
  };
}

function connectFailureTelemetry(
  pending: PendingConnectWs,
  error: Extract<ChatClientCoreEvent, { type: "ws/open.result"; ok: false }>["error"],
): ChatClientCoreCommand {
  return {
    type: "cmd/telemetry.send",
    event:
      error.type === "handshake_http_error"
        ? {
            name: "vscodeChat.ws.connect",
            outcome: "handshake_http_error",
            httpStatus: error.status,
            usedCachedSession: pending.usedCachedSession,
            recovered: pending.recovered,
          }
        : {
            name: "vscodeChat.ws.connect",
            outcome: "network_error",
            usedCachedSession: pending.usedCachedSession,
            recovered: pending.recovered,
          },
  };
}

function handleOpenSuccess(state: ChatClientCoreState, pending: PendingConnectWs): ReduceResult {
  return {
    state: {
      ...state,
      publicState: {
        authStatus: "signedIn",
        status: "connected",
        backendUrl: pending.backendUrl,
        user: pending.user,
      },
      pending: undefined,
      reconnectAttempt: 0,
    },
    commands: [
      {
        type: "cmd/telemetry.send",
        event: {
          name: "vscodeChat.ws.connect",
          outcome: "success",
          usedCachedSession: pending.usedCachedSession,
          recovered: pending.recovered,
        },
      },
    ],
  };
}

function maybeRecoverCachedSession401(
  state: ChatClientCoreState,
  pending: PendingConnectWs,
  event: Extract<ChatClientCoreEvent, { type: "ws/open.result"; ok: false }>,
): ReduceResult | undefined {
  if (
    !pending.usedCachedSession ||
    pending.recovered ||
    event.error.type !== "handshake_http_error" ||
    event.error.status !== 401
  ) {
    return undefined;
  }

  return {
    state: {
      ...state,
      cachedSession: undefined,
      pending: {
        type: "pending/connect.exchange",
        origin: pending.origin,
        backendUrl: pending.backendUrl,
        githubAccountId: pending.githubAccountId,
        accessToken: pending.accessToken,
        usedCachedSession: true,
        recovered: true,
      },
    },
    commands: [
      {
        type: "cmd/auth.exchange",
        backendUrl: pending.backendUrl,
        accessToken: pending.accessToken,
      },
    ],
  };
}

function handleNon429Failure(options: {
  state: ChatClientCoreState;
  pending: PendingConnectWs;
  event: Extract<ChatClientCoreEvent, { type: "ws/open.result"; ok: false }>;
}): ReduceResult {
  const commands: ChatClientCoreCommand[] = [
    connectFailureTelemetry(options.pending, options.event.error),
  ];

  if (options.pending.origin === "user") {
    commands.push({
      type: "cmd/raise",
      error: options.event.cause ?? new Error("ws_connect_failed"),
    });
  }

  return {
    state: toDisconnectedState(options.state),
    commands,
  };
}

export function handleWsOpenResult(
  state: ChatClientCoreState,
  event: Extract<ChatClientCoreEvent, { type: "ws/open.result" }>,
): ReduceResult {
  const pending = state.pending;
  if (pending?.type !== "pending/connect.ws") return { state, commands: [] };
  if (event.ok) return handleOpenSuccess(state, pending);

  const recovered = maybeRecoverCachedSession401(state, pending, event);
  if (recovered) return recovered;

  if (event.error.type === "handshake_http_error" && event.error.status === 429) {
    return handleHandshake429Failure({
      state,
      pending,
      error: event.error,
      connectFailureTelemetry: connectFailureTelemetry(pending, event.error),
      toDisconnectedState,
    });
  }

  return handleNon429Failure({ state, pending, event });
}
