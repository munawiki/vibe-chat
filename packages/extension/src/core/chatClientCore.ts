import type { AuthUser } from "@vscode-chat/protocol";

export type AuthStatus = "signedOut" | "signedIn";

type SignedOutDisconnectedState = {
  authStatus: "signedOut";
  status: "disconnected";
  backendUrl?: string;
  user?: never;
};

type SignedOutConnectingState = {
  authStatus: "signedOut";
  status: "connecting";
  backendUrl: string;
  user?: never;
};

type SignedInDisconnectedState = {
  authStatus: "signedIn";
  status: "disconnected";
  backendUrl?: string;
  user?: AuthUser;
};

type SignedInConnectingState = {
  authStatus: "signedIn";
  status: "connecting";
  backendUrl: string;
  user?: AuthUser;
};

type SignedInConnectedState = {
  authStatus: "signedIn";
  status: "connected";
  backendUrl: string;
  user: AuthUser;
};

export type ChatClientState =
  | SignedOutDisconnectedState
  | SignedOutConnectingState
  | SignedInDisconnectedState
  | SignedInConnectingState
  | SignedInConnectedState;

export type GitHubSession = {
  githubAccountId: string;
  accessToken: string;
};

export type CachedSession = {
  githubAccountId: string;
  token: string;
  expiresAtMs: number;
  user: AuthUser;
};

type PendingAuth = {
  type: "pending/auth";
  interactive: boolean;
};

type PendingConnectAwaitingSession = {
  type: "pending/connect.session";
  origin: "user" | "reconnect";
  backendUrl: string;
  interactive: boolean;
};

type PendingConnectAwaitingExchange = {
  type: "pending/connect.exchange";
  origin: "user" | "reconnect";
  backendUrl: string;
  githubAccountId: string;
  accessToken: string;
  usedCachedSession: boolean;
  recovered: boolean;
};

type PendingConnectAwaitingWsOpen = {
  type: "pending/connect.ws";
  origin: "user" | "reconnect";
  backendUrl: string;
  githubAccountId: string;
  accessToken: string;
  token: string;
  user: AuthUser;
  usedCachedSession: boolean;
  recovered: boolean;
};

type Pending =
  | PendingAuth
  | PendingConnectAwaitingSession
  | PendingConnectAwaitingExchange
  | PendingConnectAwaitingWsOpen;

export type ChatClientCoreState = {
  publicState: ChatClientState;
  githubAccountId: string | undefined;
  cachedSession: CachedSession | undefined;
  reconnectAttempt: number;
  reconnectScheduled: boolean;
  pending: Pending | undefined;
};

export type AuthExchangeError =
  | { type: "http"; status: number }
  | { type: "invalid_response" }
  | { type: "network_error" };

export type WsOpenError =
  | { type: "handshake_http_error"; status: number }
  | { type: "network_error" };

export type ChatClientCoreEvent =
  | { type: "auth/refresh.requested" }
  | { type: "ui/signIn" }
  | { type: "ui/connect"; origin: "user" | "reconnect"; backendUrl: string; interactive: boolean }
  | { type: "ui/disconnect" }
  | { type: "github/session.result"; ok: true; session: GitHubSession; nowMs: number }
  | { type: "github/session.result"; ok: false; nowMs: number; error?: unknown }
  | { type: "auth/exchange.result"; ok: true; session: Omit<CachedSession, "githubAccountId"> }
  | { type: "auth/exchange.result"; ok: false; error: AuthExchangeError }
  | { type: "ws/open.result"; ok: true }
  | { type: "ws/open.result"; ok: false; error: WsOpenError; cause?: unknown }
  | { type: "ws/closed"; autoReconnectEnabled: boolean }
  | { type: "timer/reconnect.fired"; backendUrl: string };

export type TelemetryEvent =
  | { name: "vscodeChat.auth.exchange"; outcome: "success" }
  | { name: "vscodeChat.auth.exchange"; outcome: "http_error"; httpStatus: number }
  | { name: "vscodeChat.auth.exchange"; outcome: "invalid_response" }
  | { name: "vscodeChat.auth.exchange"; outcome: "network_error" }
  | {
      name: "vscodeChat.ws.connect";
      outcome: "success";
      usedCachedSession: boolean;
      recovered: boolean;
    }
  | {
      name: "vscodeChat.ws.connect";
      outcome: "handshake_http_error";
      httpStatus: number;
      usedCachedSession: boolean;
      recovered: boolean;
    }
  | {
      name: "vscodeChat.ws.connect";
      outcome: "network_error";
      usedCachedSession: boolean;
      recovered: boolean;
    }
  | { name: "vscodeChat.ws.reconnect_scheduled"; attempt: number; delayMs: number };

export type ChatClientCoreCommand =
  | { type: "cmd/github.session.get"; interactive: boolean }
  | { type: "cmd/auth.exchange"; backendUrl: string; accessToken: string }
  | { type: "cmd/ws.open"; backendUrl: string; token: string }
  | { type: "cmd/ws.close"; code: number; reason: string }
  | { type: "cmd/reconnect.cancel" }
  | { type: "cmd/reconnect.schedule"; delayMs: number }
  | { type: "cmd/telemetry.send"; event: TelemetryEvent }
  | { type: "cmd/raise"; error: unknown };

const SESSION_SKEW_MS = 30_000;

export const initialChatClientCoreState = (): ChatClientCoreState => ({
  publicState: { authStatus: "signedOut", status: "disconnected" },
  githubAccountId: undefined,
  cachedSession: undefined,
  reconnectAttempt: 0,
  reconnectScheduled: false,
  pending: undefined,
});

export function computeReconnectDelayMs(attempt: number): number {
  const exponent = Math.min(attempt, 6);
  return Math.min(30_000, 500 * Math.pow(2, exponent));
}

function toSignedOutDisconnected(
  prev: ChatClientState,
  backendUrl?: string,
): SignedOutDisconnectedState {
  const previousBackendUrl = backendUrl ?? prev.backendUrl;
  return previousBackendUrl
    ? { authStatus: "signedOut", status: "disconnected", backendUrl: previousBackendUrl }
    : { authStatus: "signedOut", status: "disconnected" };
}

function assertNever(x: never): never {
  throw new Error(`unreachable: ${JSON.stringify(x)}`);
}

export function reduceChatClientCore(
  state: ChatClientCoreState,
  event: ChatClientCoreEvent,
): { state: ChatClientCoreState; commands: ChatClientCoreCommand[] } {
  switch (event.type) {
    case "auth/refresh.requested": {
      return {
        state: { ...state, pending: { type: "pending/auth", interactive: false } },
        commands: [{ type: "cmd/github.session.get", interactive: false }],
      };
    }
    case "ui/signIn": {
      return {
        state: { ...state, pending: { type: "pending/auth", interactive: true } },
        commands: [{ type: "cmd/github.session.get", interactive: true }],
      };
    }
    case "ui/connect": {
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
    case "ui/disconnect": {
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
    case "github/session.result": {
      const pending = state.pending;
      if (!pending) return { state, commands: [] };

      switch (pending.type) {
        case "pending/auth": {
          if (!event.ok) {
            const signedOut = {
              ...state,
              publicState: toSignedOutDisconnected(state.publicState),
              githubAccountId: undefined,
              cachedSession: undefined,
              pending: undefined,
              reconnectAttempt: 0,
              reconnectScheduled: false,
            };
            return {
              state: signedOut,
              commands: [
                { type: "cmd/reconnect.cancel" },
                { type: "cmd/ws.close", code: 1000, reason: "auth_signed_out" },
                ...(pending.interactive
                  ? [
                      {
                        type: "cmd/raise",
                        error: event.error ?? new Error("github_session_missing"),
                      } satisfies ChatClientCoreCommand,
                    ]
                  : []),
              ],
            };
          }

          return {
            state: {
              ...state,
              githubAccountId: event.session.githubAccountId,
              publicState: { ...state.publicState, authStatus: "signedIn" },
              pending: undefined,
            },
            commands: [],
          };
        }
        case "pending/connect.session": {
          if (!event.ok) {
            const nextPublicState = pending.interactive
              ? toSignedOutDisconnected(state.publicState, pending.backendUrl)
              : toSignedOutDisconnected(state.publicState);

            const commands: ChatClientCoreCommand[] = [
              { type: "cmd/reconnect.cancel" },
              { type: "cmd/ws.close", code: 1000, reason: "auth_signed_out" },
            ];
            if (pending.origin === "user" && (pending.interactive || event.error)) {
              commands.push({
                type: "cmd/raise",
                error: event.error ?? new Error("github_session_missing"),
              });
            }

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
              commands,
            };
          }

          const { githubAccountId, accessToken } = event.session;
          const accountChanged = Boolean(
            state.githubAccountId && state.githubAccountId !== githubAccountId,
          );
          const cachedSession = accountChanged ? undefined : state.cachedSession;

          const reusableCached =
            cachedSession &&
            cachedSession.githubAccountId === githubAccountId &&
            cachedSession.expiresAtMs - SESSION_SKEW_MS > event.nowMs
              ? cachedSession
              : undefined;

          if (reusableCached) {
            return {
              state: {
                ...state,
                githubAccountId,
                cachedSession,
                publicState: {
                  authStatus: "signedIn",
                  status: "connecting",
                  backendUrl: pending.backendUrl,
                  user: reusableCached.user,
                },
                pending: {
                  type: "pending/connect.ws",
                  origin: pending.origin,
                  backendUrl: pending.backendUrl,
                  githubAccountId,
                  accessToken,
                  token: reusableCached.token,
                  user: reusableCached.user,
                  usedCachedSession: true,
                  recovered: false,
                },
              },
              commands: [
                {
                  type: "cmd/ws.open",
                  backendUrl: pending.backendUrl,
                  token: reusableCached.token,
                },
              ],
            };
          }

          return {
            state: {
              ...state,
              githubAccountId,
              cachedSession,
              publicState: {
                authStatus: "signedIn",
                status: "connecting",
                backendUrl: pending.backendUrl,
              },
              pending: {
                type: "pending/connect.exchange",
                origin: pending.origin,
                backendUrl: pending.backendUrl,
                githubAccountId,
                accessToken,
                usedCachedSession: false,
                recovered: false,
              },
            },
            commands: [{ type: "cmd/auth.exchange", backendUrl: pending.backendUrl, accessToken }],
          };
        }
        case "pending/connect.exchange":
        case "pending/connect.ws":
          return { state, commands: [] };
        default:
          assertNever(pending);
      }
    }
    case "auth/exchange.result": {
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
    case "ws/open.result": {
      const pending = state.pending;
      if (!pending || pending.type !== "pending/connect.ws") return { state, commands: [] };

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
    case "ws/closed": {
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
    case "timer/reconnect.fired": {
      if (state.publicState.authStatus !== "signedIn") {
        return { state: { ...state, reconnectScheduled: false }, commands: [] };
      }

      return reduceChatClientCore(
        { ...state, reconnectScheduled: false },
        {
          type: "ui/connect",
          origin: "reconnect",
          backendUrl: event.backendUrl,
          interactive: false,
        },
      );
    }
    default:
      assertNever(event);
  }
}
