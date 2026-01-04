import { toSignedOutDisconnected } from "../helpers.js";
import type {
  CachedSession,
  ChatClientCoreCommand,
  ChatClientCoreEvent,
  ChatClientCoreState,
} from "../types.js";
import type { ReduceResult } from "./types.js";

export function handleAuthExchangeResult(
  state: ChatClientCoreState,
  event: Extract<ChatClientCoreEvent, { type: "auth/exchange.result" }>,
): ReduceResult {
  const pending = state.pending;
  if (!pending || pending.type !== "pending/connect.exchange") return { state, commands: [] };

  if (!event.ok) {
    const commands: ChatClientCoreCommand[] = [];

    if (event.error.type === "http") {
      commands.push({
        type: "cmd/telemetry.send",
        event: {
          name: "vscodeChat.auth.exchange",
          outcome: "http_error",
          httpStatus: event.error.status,
        },
      });
    } else if (event.error.type === "invalid_response") {
      commands.push({
        type: "cmd/telemetry.send",
        event: { name: "vscodeChat.auth.exchange", outcome: "invalid_response" },
      });
    } else {
      commands.push({
        type: "cmd/telemetry.send",
        event: { name: "vscodeChat.auth.exchange", outcome: "network_error" },
      });
    }

    const shouldSignOut =
      event.error.type === "http" && (event.error.status === 401 || event.error.status === 403);
    if (shouldSignOut) {
      commands.push({ type: "cmd/reconnect.cancel" });
      commands.push({ type: "cmd/ws.close", code: 1000, reason: "auth_signed_out" });
      if (pending.origin === "user")
        commands.push({ type: "cmd/raise", error: new Error("auth_exchange_http_error") });

      return {
        state: {
          ...state,
          publicState: toSignedOutDisconnected(state.publicState),
          githubAccountId: undefined,
          cachedSession: undefined,
          pending: undefined,
          reconnectAttempt: 0,
          reconnectScheduled: false,
        },
        commands,
      };
    }

    if (pending.origin === "user")
      commands.push({ type: "cmd/raise", error: new Error("auth_exchange_failed") });

    return {
      state: {
        ...state,
        publicState: { ...state.publicState, status: "disconnected" },
        pending: undefined,
      },
      commands,
    };
  }

  const cachedSession: CachedSession = {
    githubAccountId: pending.githubAccountId,
    token: event.session.token,
    expiresAtMs: event.session.expiresAtMs,
    user: event.session.user,
  };

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
