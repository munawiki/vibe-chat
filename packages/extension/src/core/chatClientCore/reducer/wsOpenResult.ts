import { computeReconnectDelayMs } from "../helpers.js";
import type { ChatClientCoreCommand, ChatClientCoreEvent, ChatClientCoreState } from "../types.js";
import type { ReduceResult } from "./types.js";

type Handshake429Kind = "rate_limited" | "room_full" | "too_many_connections" | "unknown";
type Handshake429Code = Exclude<Handshake429Kind, "unknown">;

function classifyHandshake429(error: {
  retryAfterMs?: number;
  bodyText?: string;
  handshakeRejection?: { code: Handshake429Code };
}): { kind: Handshake429Kind; source: "typed_code" | "retry_after" | "legacy_body" | "unknown" } {
  if (error.handshakeRejection?.code) {
    return { kind: error.handshakeRejection.code, source: "typed_code" };
  }
  if (typeof error.retryAfterMs === "number") {
    return { kind: "rate_limited", source: "retry_after" };
  }

  const body = error.bodyText?.toLowerCase();
  if (!body) return { kind: "unknown", source: "unknown" };

  // These strings are the current backend responses (best-effort classification only).
  if (body.includes("too many connection attempts")) {
    return { kind: "rate_limited", source: "legacy_body" };
  }
  if (body.includes("room is full")) return { kind: "room_full", source: "legacy_body" };
  if (body.includes("too many connections")) {
    return { kind: "too_many_connections", source: "legacy_body" };
  }
  return { kind: "unknown", source: "legacy_body" };
}

function formatHandshake429Message(kind: Handshake429Kind, retryAfterMs?: number): string {
  switch (kind) {
    case "rate_limited": {
      if (typeof retryAfterMs === "number") {
        const seconds = Math.ceil(retryAfterMs / 1000);
        return `Rate limited: too many connection attempts. Retry after ${seconds}s.`;
      }
      return "Rate limited: too many connection attempts. Retry later.";
    }
    case "room_full":
      return "Room is full. Retry later.";
    case "too_many_connections":
      return "Too many concurrent connections for this user. Close other VS Code windows and retry.";
    case "unknown":
      return "Connection rejected by server (HTTP 429). Retry later.";
  }
}

export function handleWsOpenResult(
  state: ChatClientCoreState,
  event: Extract<ChatClientCoreEvent, { type: "ws/open.result" }>,
): ReduceResult {
  const pending = state.pending;
  if (pending?.type !== "pending/connect.ws") return { state, commands: [] };

  if (event.ok) {
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

  if (
    pending.usedCachedSession &&
    !pending.recovered &&
    event.error.type === "handshake_http_error" &&
    event.error.status === 401
  ) {
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

  if (event.error.type === "handshake_http_error" && event.error.status === 429) {
    const classification = classifyHandshake429(event.error);
    const kind = classification.kind;

    const commands: ChatClientCoreCommand[] = [
      {
        type: "cmd/telemetry.send",
        event: {
          name: "vscodeChat.ws.connect",
          outcome: "handshake_http_error",
          httpStatus: event.error.status,
          usedCachedSession: pending.usedCachedSession,
          recovered: pending.recovered,
        },
      },
    ];
    if (classification.source === "legacy_body") {
      commands.push({
        type: "cmd/telemetry.send",
        event: {
          name: "vscodeChat.ws.legacy_fallback",
          fallback: "handshake_429_body",
          kind,
        },
      });
    }

    // Policy: When auto-reconnecting, treat 429s as a signal to stop or slow down retries.
    if (pending.origin === "reconnect") {
      // Rate-limited handshakes include Retry-After; clamp the retry delay to the server suggestion.
      if (kind === "rate_limited") {
        const attempt = state.reconnectAttempt;
        const localBackoffMs = computeReconnectDelayMs(attempt);
        const delayMs = Math.max(localBackoffMs, event.error.retryAfterMs ?? localBackoffMs);

        commands.push(
          {
            type: "cmd/telemetry.send",
            event: { name: "vscodeChat.ws.reconnect_scheduled", attempt, delayMs },
          },
          { type: "cmd/reconnect.schedule", delayMs },
        );

        return {
          state: {
            ...state,
            publicState: { ...state.publicState, status: "disconnected" },
            pending: undefined,
            reconnectAttempt: attempt + 1,
            reconnectScheduled: true,
          },
          commands,
        };
      }

      // Capacity errors (or unknown 429) are treated as non-retriable without user action.
      commands.push({ type: "cmd/reconnect.cancel" });
      return {
        state: {
          ...state,
          publicState: { ...state.publicState, status: "disconnected" },
          pending: undefined,
          reconnectScheduled: true,
        },
        commands,
      };
    }

    commands.push({
      type: "cmd/raise",
      error: new Error(formatHandshake429Message(kind, event.error.retryAfterMs)),
    });
    return {
      state: {
        ...state,
        publicState: { ...state.publicState, status: "disconnected" },
        pending: undefined,
      },
      commands,
    };
  }

  const commands: ChatClientCoreCommand[] = [
    {
      type: "cmd/telemetry.send",
      event:
        event.error.type === "handshake_http_error"
          ? {
              name: "vscodeChat.ws.connect",
              outcome: "handshake_http_error",
              httpStatus: event.error.status,
              usedCachedSession: pending.usedCachedSession,
              recovered: pending.recovered,
            }
          : {
              name: "vscodeChat.ws.connect",
              outcome: "network_error",
              usedCachedSession: pending.usedCachedSession,
              recovered: pending.recovered,
            },
    },
  ];

  if (pending.origin === "user")
    commands.push({ type: "cmd/raise", error: event.cause ?? new Error("ws_connect_failed") });

  return {
    state: {
      ...state,
      publicState: { ...state.publicState, status: "disconnected" },
      pending: undefined,
    },
    commands,
  };
}
