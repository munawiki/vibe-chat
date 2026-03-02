import { assertNever, toSignedOutDisconnected } from "../helpers.js";
import type { ChatClientCoreCommand, ChatClientCoreEvent, ChatClientCoreState } from "../types.js";
import type { ReduceResult } from "./types.js";
import { handleNoSession } from "./githubSessionNoSession.js";
import { handleSessionReady } from "./githubSessionReady.js";
import { didGithubAccountChange } from "./githubSessionShared.js";

type GithubSessionResultEvent = Extract<ChatClientCoreEvent, { type: "github/session.result" }>;
type PendingAuth = Extract<ChatClientCoreState["pending"], { type: "pending/auth" }>;
type PendingConnectSession = Extract<
  ChatClientCoreState["pending"],
  { type: "pending/connect.session" }
>;

export function handleGithubSessionResult(
  state: ChatClientCoreState,
  event: Extract<ChatClientCoreEvent, { type: "github/session.result" }>,
): ReduceResult {
  const pending = state.pending;
  if (!pending) return { state, commands: [] };

  switch (pending.type) {
    case "pending/auth":
      return handlePendingAuth(state, pending, event);
    case "pending/connect.session":
      return handlePendingConnectSession(state, pending, event);
    case "pending/connect.exchange":
    case "pending/connect.ws":
      return { state, commands: [] };
    default:
      assertNever(pending);
  }
}

function handlePendingAuth(
  state: ChatClientCoreState,
  pending: PendingAuth,
  event: GithubSessionResultEvent,
): ReduceResult {
  if (!event.ok) {
    const nextState: ChatClientCoreState = {
      ...state,
      publicState: toSignedOutDisconnected(state.publicState),
      githubAccountId: undefined,
      cachedSession: undefined,
      pending: undefined,
      reconnectAttempt: 0,
      reconnectScheduled: false,
    };

    const commands: ChatClientCoreCommand[] = [
      { type: "cmd/reconnect.cancel" },
      { type: "cmd/ws.close", code: 1000, reason: "auth_signed_out" },
    ];
    if (pending.interactive) {
      commands.push({
        type: "cmd/raise",
        error: event.error ?? new Error("github_session_missing"),
      });
    }

    return { state: nextState, commands };
  }

  const nextGithubAccountId = event.session.githubAccountId;
  const accountChanged = didGithubAccountChange(state.githubAccountId, nextGithubAccountId);
  if (accountChanged) {
    const publicState: ChatClientCoreState["publicState"] = {
      authStatus: "signedIn",
      status: "disconnected",
    };
    if (state.publicState.backendUrl) {
      publicState.backendUrl = state.publicState.backendUrl;
    }

    return {
      state: {
        ...state,
        githubAccountId: nextGithubAccountId,
        cachedSession: undefined,
        publicState,
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

  const nextState: ChatClientCoreState = {
    ...state,
    githubAccountId: nextGithubAccountId,
    publicState: { ...state.publicState, authStatus: "signedIn" },
    pending: undefined,
  };
  if (pending.interactive) {
    nextState.authSuppressedByUser = false;
    nextState.clearSessionPreferenceOnNextSignIn = false;
  }

  return { state: nextState, commands: [] };
}

function handlePendingConnectSession(
  state: ChatClientCoreState,
  pending: PendingConnectSession,
  event: GithubSessionResultEvent,
): ReduceResult {
  return event.ok
    ? handleSessionReady(state, pending, event)
    : handleNoSession(state, pending, event);
}
