import { assertNever, toSignedOutDisconnected } from "../helpers.js";
import type { ChatClientCoreCommand, ChatClientCoreEvent, ChatClientCoreState } from "../types.js";
import type { ReduceResult } from "./types.js";

const SESSION_SKEW_MS = 30_000;

export function handleGithubSessionResult(
  state: ChatClientCoreState,
  event: Extract<ChatClientCoreEvent, { type: "github/session.result" }>,
): ReduceResult {
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

      const accountChanged = Boolean(
        state.githubAccountId && state.githubAccountId !== event.session.githubAccountId,
      );

      if (accountChanged) {
        return {
          state: {
            ...state,
            githubAccountId: event.session.githubAccountId,
            cachedSession: undefined,
            publicState: {
              authStatus: "signedIn",
              status: "disconnected",
              ...(state.publicState.backendUrl ? { backendUrl: state.publicState.backendUrl } : {}),
            },
            pending: undefined,
            reconnectAttempt: 0,
            reconnectScheduled: false,
          },
          commands: [
            { type: "cmd/reconnect.cancel" },
            { type: "cmd/ws.close", code: 1000, reason: "github_account_changed" },
          ],
        };
      }

      return {
        state: {
          ...state,
          githubAccountId: event.session.githubAccountId,
          ...(pending.interactive
            ? { authSuppressedByUser: false, clearSessionPreferenceOnNextSignIn: false }
            : {}),
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
            ...(pending.interactive
              ? { authSuppressedByUser: false, clearSessionPreferenceOnNextSignIn: false }
              : {}),
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
            { type: "cmd/ws.open", backendUrl: pending.backendUrl, token: reusableCached.token },
          ],
        };
      }

      return {
        state: {
          ...state,
          githubAccountId,
          cachedSession,
          ...(pending.interactive
            ? { authSuppressedByUser: false, clearSessionPreferenceOnNextSignIn: false }
            : {}),
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
