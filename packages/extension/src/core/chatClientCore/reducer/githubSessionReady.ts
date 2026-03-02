import type { ChatClientCoreCommand, ChatClientCoreEvent, ChatClientCoreState } from "../types.js";
import { didGithubAccountChange, pickReusableCachedSession } from "./githubSessionShared.js";
import type { ReduceResult } from "./types.js";

type PendingConnectSession = Extract<
  ChatClientCoreState["pending"],
  { type: "pending/connect.session" }
>;
type GithubSessionReadyEvent = Extract<
  Extract<ChatClientCoreEvent, { type: "github/session.result" }>,
  { ok: true }
>;

export function handleSessionReady(
  state: ChatClientCoreState,
  pending: PendingConnectSession,
  event: GithubSessionReadyEvent,
): ReduceResult {
  const { githubAccountId, accessToken } = event.session;
  const accountChanged = didGithubAccountChange(state.githubAccountId, githubAccountId);
  const cachedSession = accountChanged ? undefined : state.cachedSession;
  const reusableCached = pickReusableCachedSession({
    cachedSession,
    githubAccountId,
    nowMs: event.nowMs,
  });

  const nextState = buildConnectSessionSuccessState({
    state,
    pending,
    githubAccountId,
    accessToken,
    cachedSession,
    reusableCached,
  });
  if (pending.interactive) {
    nextState.authSuppressedByUser = false;
    nextState.clearSessionPreferenceOnNextSignIn = false;
  }

  return {
    state: nextState,
    commands: buildConnectSessionSuccessCommands(pending.backendUrl, accessToken, reusableCached),
  };
}

function buildConnectSessionSuccessState(options: {
  state: ChatClientCoreState;
  pending: PendingConnectSession;
  githubAccountId: string;
  accessToken: string;
  cachedSession: ChatClientCoreState["cachedSession"];
  reusableCached: ChatClientCoreState["cachedSession"] | undefined;
}): ChatClientCoreState {
  const { state, pending, githubAccountId, accessToken, cachedSession, reusableCached } = options;

  return {
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
}

function buildConnectSessionSuccessCommands(
  backendUrl: string,
  accessToken: string,
  reusableCached: ChatClientCoreState["cachedSession"] | undefined,
): ChatClientCoreCommand[] {
  return reusableCached
    ? [{ type: "cmd/ws.open", backendUrl, token: reusableCached.token }]
    : [{ type: "cmd/auth.exchange", backendUrl, accessToken }];
}
