import type { AuthUser, WsHandshakeRejection } from "@vscode-chat/protocol";

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

export type Pending =
  | PendingAuth
  | PendingConnectAwaitingSession
  | PendingConnectAwaitingExchange
  | PendingConnectAwaitingWsOpen;

export type ChatClientCoreState = {
  publicState: ChatClientState;
  githubAccountId: string | undefined;
  cachedSession: CachedSession | undefined;
  authSuppressedByUser: boolean;
  clearSessionPreferenceOnNextSignIn: boolean;
  reconnectAttempt: number;
  reconnectScheduled: boolean;
  pending: Pending | undefined;
};

export type AuthExchangeError =
  | { type: "http"; status: number }
  | { type: "invalid_response" }
  | { type: "network_error" };

export type WsOpenError =
  | {
      type: "handshake_http_error";
      status: number;
      retryAfterMs?: number;
      bodyText?: string;
      handshakeRejection?: WsHandshakeRejection;
    }
  | { type: "network_error" };
