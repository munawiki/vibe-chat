import type { AuthUser } from "@vscode-chat/protocol";
import type { AuthExchangeError, CachedSession, GitHubSession, WsOpenError } from "./state.js";

export type ChatClientCoreEvent =
  | { type: "auth/refresh.requested" }
  | { type: "ui/signIn" }
  | { type: "ui/signOut" }
  | { type: "ui/connect"; origin: "user" | "reconnect"; backendUrl: string; interactive: boolean }
  | { type: "ui/disconnect" }
  | { type: "github/session.result"; ok: true; session: GitHubSession; nowMs: number }
  | { type: "github/session.result"; ok: false; nowMs: number; error?: unknown }
  | { type: "auth/exchange.result"; ok: true; session: Omit<CachedSession, "githubAccountId"> }
  | { type: "auth/exchange.result"; ok: false; error: AuthExchangeError }
  | { type: "ws/open.result"; ok: true }
  | { type: "ws/open.result"; ok: false; error: WsOpenError; cause?: unknown }
  | { type: "ws/welcome"; user: AuthUser }
  | { type: "ws/closed"; autoReconnectEnabled: boolean }
  | { type: "timer/reconnect.fired"; backendUrl: string };
