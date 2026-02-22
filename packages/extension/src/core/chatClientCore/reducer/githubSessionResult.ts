import { assertNever, toSignedOutDisconnected } from "../helpers.js";
import type { ChatClientCoreCommand, ChatClientCoreEvent, ChatClientCoreState } from "../types.js";
import type { ReduceResult } from "./types.js";

const SESSION_SKEW_MS = 30_000;

type GithubSessionResultEvent = Extract<ChatClientCoreEvent, { type: "github/session.result" }>;
type PendingAuth = Extract<ChatClientCoreState["pending"], { type: "pending/auth" }>;
type PendingConnectSession = Extract<
  ChatClientCoreState["pending"],
  { type: "pending/connect.session" }
>;

function didGithubAccountChange(
  prevGithubAccountId: ChatClientCoreState["githubAccountId"],
  nextGithubAccountId: string,
): boolean {
  return Boolean(prevGithubAccountId && prevGithubAccountId !== nextGithubAccountId);
}

function pickReusableCachedSession(options: {
  cachedSession: ChatClientCoreState["cachedSession"];
  githubAccountId: string;
  nowMs: number;
}): ChatClientCoreState["cachedSession"] | undefined {
  const cachedSession = options.cachedSession;
  if (!cachedSession) return undefined;
  if (cachedSession.githubAccountId !== options.githubAccountId) return undefined;
  if (cachedSession.expiresAtMs - SESSION_SKEW_MS <= options.nowMs) return undefined;
  return cachedSession;
}

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
  if (!event.ok) {
    const nextPublicState = toSignedOutDisconnected(
      state.publicState,
      pending.interactive ? pending.backendUrl : undefined,
    );

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
  const accountChanged = didGithubAccountChange(state.githubAccountId, githubAccountId);
  const cachedSession = accountChanged ? undefined : state.cachedSession;

  const reusableCached = pickReusableCachedSession({
    cachedSession,
    githubAccountId,
    nowMs: event.nowMs,
  });

  const nextState: ChatClientCoreState = {
    ...state,
    githubAccountId,
    cachedSession,
    publicState: {
      authStatus: "signedIn",
      status: "connecting",
      backendUrl: pending.backendUrl,
      ...(reusableCached ? { user: reusableCached.user } : {}),
    },
    pending: reusableCached
      ? {
          type: "pending/connect.ws",
          origin: pending.origin,
          backendUrl: pending.backendUrl,
          githubAccountId,
          accessToken,
          token: reusableCached.token,
          user: reusableCached.user,
          usedCachedSession: true,
          recovered: false,
        }
      : {
          type: "pending/connect.exchange",
          origin: pending.origin,
          backendUrl: pending.backendUrl,
          githubAccountId,
          accessToken,
          usedCachedSession: false,
          recovered: false,
        },
  };

  if (pending.interactive) {
    nextState.authSuppressedByUser = false;
    nextState.clearSessionPreferenceOnNextSignIn = false;
  }

  const commands: ChatClientCoreCommand[] = reusableCached
    ? [{ type: "cmd/ws.open", backendUrl: pending.backendUrl, token: reusableCached.token }]
    : [{ type: "cmd/auth.exchange", backendUrl: pending.backendUrl, accessToken }];

  return { state: nextState, commands };
}
