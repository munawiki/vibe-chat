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
