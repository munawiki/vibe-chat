import { toSignedOutDisconnected } from "../helpers.js";
import type {
  CachedSession,
  ChatClientCoreCommand,
  ChatClientCoreEvent,
  ChatClientCoreState,
} from "../types.js";
import type { ReduceResult } from "./types.js";

type PendingConnectExchange = Extract<
  ChatClientCoreState["pending"],
  { type: "pending/connect.exchange" }
>;
type AuthExchangeError = Extract<
  ChatClientCoreEvent,
  { type: "auth/exchange.result"; ok: false }
>["error"];
type AuthExchangeSuccessEvent = Extract<
  ChatClientCoreEvent,
  { type: "auth/exchange.result"; ok: true }
>;

function telemetryForAuthExchangeError(error: AuthExchangeError): ChatClientCoreCommand {
  if (error.type === "http") {
    return {
      type: "cmd/telemetry.send",
      event: {
        name: "vscodeChat.auth.exchange",
        outcome: "http_error",
        httpStatus: error.status,
      },
    };
  }
  if (error.type === "invalid_response") {
    return {
      type: "cmd/telemetry.send",
      event: { name: "vscodeChat.auth.exchange", outcome: "invalid_response" },
    };
  }
  return {
    type: "cmd/telemetry.send",
    event: { name: "vscodeChat.auth.exchange", outcome: "network_error" },
  };
}

function shouldSignOutOnAuthExchangeError(error: AuthExchangeError): boolean {
  return error.type === "http" && (error.status === 401 || error.status === 403);
}

function buildSignedOutState(state: ChatClientCoreState): ChatClientCoreState {
  return {
    ...state,
    publicState: toSignedOutDisconnected(state.publicState),
    githubAccountId: undefined,
    cachedSession: undefined,
    pending: undefined,
    reconnectAttempt: 0,
    reconnectScheduled: false,
  };
}

function buildDisconnectedState(state: ChatClientCoreState): ChatClientCoreState {
  return {
    ...state,
    publicState: { ...state.publicState, status: "disconnected" },
    pending: undefined,
  };
}

function handleAuthExchangeFailure(
  state: ChatClientCoreState,
  pending: PendingConnectExchange,
  error: AuthExchangeError,
): ReduceResult {
  const commands: ChatClientCoreCommand[] = [telemetryForAuthExchangeError(error)];
  if (shouldSignOutOnAuthExchangeError(error)) {
    commands.push(
      { type: "cmd/reconnect.cancel" },
      { type: "cmd/ws.close", code: 1000, reason: "auth_signed_out" },
    );
    if (pending.origin === "user") {
      commands.push({ type: "cmd/raise", error: new Error("auth_exchange_http_error") });
    }
    return { state: buildSignedOutState(state), commands };
  }

  if (pending.origin === "user") {
    commands.push({ type: "cmd/raise", error: new Error("auth_exchange_failed") });
  }
  return { state: buildDisconnectedState(state), commands };
}

function toCachedSession(
  pending: PendingConnectExchange,
  event: AuthExchangeSuccessEvent,
): CachedSession {
  return {
    githubAccountId: pending.githubAccountId,
    token: event.session.token,
    expiresAtMs: event.session.expiresAtMs,
    user: event.session.user,
  };
}

function handleAuthExchangeSuccess(
  state: ChatClientCoreState,
  pending: PendingConnectExchange,
  event: AuthExchangeSuccessEvent,
): ReduceResult {
  const cachedSession = toCachedSession(pending, event);
  return {
    state: {
      ...state,
      cachedSession,
      publicState: {
        authStatus: "signedIn",
        status: "connecting",
        backendUrl: pending.backendUrl,
        user: cachedSession.user,
      },
      pending: {
        type: "pending/connect.ws",
        origin: pending.origin,
        backendUrl: pending.backendUrl,
        githubAccountId: pending.githubAccountId,
        accessToken: pending.accessToken,
        token: cachedSession.token,
        user: cachedSession.user,
        usedCachedSession: pending.usedCachedSession,
        recovered: pending.recovered,
      },
    },
    commands: [
      {
        type: "cmd/telemetry.send",
        event: { name: "vscodeChat.auth.exchange", outcome: "success" },
      },
      { type: "cmd/ws.open", backendUrl: pending.backendUrl, token: cachedSession.token },
    ],
  };
}

export function handleAuthExchangeResult(
  state: ChatClientCoreState,
  event: Extract<ChatClientCoreEvent, { type: "auth/exchange.result" }>,
): ReduceResult {
  const pending = state.pending;
  if (pending?.type !== "pending/connect.exchange") return { state, commands: [] };
  if (!event.ok) return handleAuthExchangeFailure(state, pending, event.error);
  return handleAuthExchangeSuccess(state, pending, event);
}
