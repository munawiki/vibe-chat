import { toSignedOutDisconnected } from "../helpers.js";
import type { ChatClientCoreCommand, ChatClientCoreEvent, ChatClientCoreState } from "../types.js";
import type { ReduceResult } from "./types.js";

type PendingConnectSession = Extract<
  ChatClientCoreState["pending"],
  { type: "pending/connect.session" }
>;
type GithubNoSessionEvent = Extract<
  Extract<ChatClientCoreEvent, { type: "github/session.result" }>,
  { ok: false }
>;

export function handleNoSession(
  state: ChatClientCoreState,
  pending: PendingConnectSession,
  event: GithubNoSessionEvent,
): ReduceResult {
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
