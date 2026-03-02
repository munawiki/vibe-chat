import { computeReconnectDelayMs } from "../helpers.js";
import type { ChatClientCoreCommand, ChatClientCoreEvent, ChatClientCoreState } from "../types.js";
import type { ReduceResult } from "./types.js";

type Handshake429Kind = "rate_limited" | "room_full" | "too_many_connections" | "unknown";
type Handshake429Code = Exclude<Handshake429Kind, "unknown">;
type PendingConnectWs = Extract<ChatClientCoreState["pending"], { type: "pending/connect.ws" }>;
type Handshake429Error = Extract<
  Extract<ChatClientCoreEvent, { type: "ws/open.result"; ok: false }>["error"],
  { type: "handshake_http_error" }
>;

function retryAfterMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function classifyHandshake429(error: {
  retryAfterMs?: number;
  bodyText?: string;
  handshakeRejection?: { code: Handshake429Code };
}): { kind: Handshake429Kind; source: "typed_code" | "retry_after" | "legacy_body" | "unknown" } {
  if (error.handshakeRejection?.code) {
    return { kind: error.handshakeRejection.code, source: "typed_code" };
  }
  if (typeof error.retryAfterMs === "number")
    return { kind: "rate_limited", source: "retry_after" };

  const body = error.bodyText?.toLowerCase();
  if (!body) return { kind: "unknown", source: "unknown" };
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
      if (typeof retryAfterMs !== "number") {
        return "Rate limited: too many connection attempts. Retry later.";
      }
      const seconds = Math.ceil(retryAfterMs / 1000);
      return `Rate limited: too many connection attempts. Retry after ${seconds}s.`;
    }
    case "room_full":
      return "Room is full. Retry later.";
    case "too_many_connections":
      return "Too many concurrent connections for this user. Close other VS Code windows and retry.";
    case "unknown":
      return "Connection rejected by server (HTTP 429). Retry later.";
  }
}

function telemetryCommandsFor429(options: {
  connectFailureTelemetry: ChatClientCoreCommand;
  classification: ReturnType<typeof classifyHandshake429>;
}): ChatClientCoreCommand[] {
  const commands: ChatClientCoreCommand[] = [options.connectFailureTelemetry];
  if (options.classification.source === "legacy_body") {
    commands.push({
      type: "cmd/telemetry.send",
      event: {
        name: "vscodeChat.ws.legacy_fallback",
        fallback: "handshake_429_body",
        kind: options.classification.kind,
      },
    });
  }
  return commands;
}

function handleReconnect429(options: {
  state: ChatClientCoreState;
  kind: Handshake429Kind;
  error: Handshake429Error;
  commands: ChatClientCoreCommand[];
  toDisconnectedState: (state: ChatClientCoreState) => ChatClientCoreState;
}): ReduceResult {
  if (options.kind !== "rate_limited") {
    return {
      state: {
        ...options.toDisconnectedState(options.state),
        reconnectScheduled: true,
      },
      commands: [...options.commands, { type: "cmd/reconnect.cancel" }],
    };
  }

  const attempt = options.state.reconnectAttempt;
  const localBackoffMs = computeReconnectDelayMs(attempt);
  const retryAfter = retryAfterMs(options.error.retryAfterMs);
  const delayMs = Math.max(localBackoffMs, retryAfter ?? localBackoffMs);
  return {
    state: {
      ...options.toDisconnectedState(options.state),
      reconnectAttempt: attempt + 1,
      reconnectScheduled: true,
    },
    commands: [
      ...options.commands,
      {
        type: "cmd/telemetry.send",
        event: { name: "vscodeChat.ws.reconnect_scheduled", attempt, delayMs },
      },
      { type: "cmd/reconnect.schedule", delayMs },
    ],
  };
}

function handleUser429(options: {
  state: ChatClientCoreState;
  kind: Handshake429Kind;
  error: Handshake429Error;
  commands: ChatClientCoreCommand[];
  toDisconnectedState: (state: ChatClientCoreState) => ChatClientCoreState;
}): ReduceResult {
  return {
    state: options.toDisconnectedState(options.state),
    commands: [
      ...options.commands,
      {
        type: "cmd/raise",
        error: new Error(
          formatHandshake429Message(options.kind, retryAfterMs(options.error.retryAfterMs)),
        ),
      },
    ],
  };
}

export function handleHandshake429Failure(options: {
  state: ChatClientCoreState;
  pending: PendingConnectWs;
  error: Handshake429Error;
  connectFailureTelemetry: ChatClientCoreCommand;
  toDisconnectedState: (state: ChatClientCoreState) => ChatClientCoreState;
}): ReduceResult {
  const classification = classifyHandshake429(options.error);
  const commands = telemetryCommandsFor429({
    connectFailureTelemetry: options.connectFailureTelemetry,
    classification,
  });

  return options.pending.origin === "reconnect"
    ? handleReconnect429({
        state: options.state,
        kind: classification.kind,
        error: options.error,
        commands,
        toDisconnectedState: options.toDisconnectedState,
      })
    : handleUser429({
        state: options.state,
        kind: classification.kind,
        error: options.error,
        commands,
        toDisconnectedState: options.toDisconnectedState,
      });
}
