import type * as vscode from "vscode";
import type { ExtensionBus } from "../../bus/extensionBus.js";
import type { ChatClientCoreState } from "../../core/chatClientCore.js";

export const AUTH_SUPPRESSED_BY_USER_KEY = "vscodeChat.auth.suppressedByUser.v1";
export const CLEAR_SESSION_PREFERENCE_ON_NEXT_SIGN_IN_KEY =
  "vscodeChat.auth.clearSessionPreferenceOnNextSignIn.v1";

export function readInitialAuthPreferences(globalState: vscode.Memento): {
  authSuppressedByUser: boolean;
  clearSessionPreferenceOnNextSignIn: boolean;
} {
  return {
    authSuppressedByUser: globalState.get<boolean>(AUTH_SUPPRESSED_BY_USER_KEY) ?? false,
    clearSessionPreferenceOnNextSignIn:
      globalState.get<boolean>(CLEAR_SESSION_PREFERENCE_ON_NEXT_SIGN_IN_KEY) ?? false,
  };
}

export async function syncChatClientPersistentState(options: {
  prev: ChatClientCoreState;
  next: ChatClientCoreState;
  globalState: vscode.Memento;
  output: vscode.LogOutputChannel;
}): Promise<void> {
  const { prev, next, globalState, output } = options;
  const updates: Promise<void>[] = [];

  if (prev.authSuppressedByUser !== next.authSuppressedByUser) {
    updates.push(
      Promise.resolve(globalState.update(AUTH_SUPPRESSED_BY_USER_KEY, next.authSuppressedByUser)),
    );
  }

  if (prev.clearSessionPreferenceOnNextSignIn !== next.clearSessionPreferenceOnNextSignIn) {
    updates.push(
      Promise.resolve(
        globalState.update(
          CLEAR_SESSION_PREFERENCE_ON_NEXT_SIGN_IN_KEY,
          next.clearSessionPreferenceOnNextSignIn,
        ),
      ),
    );
  }

  try {
    await Promise.all(updates);
  } catch (err) {
    output.warn(`Failed to persist auth state: ${String(err)}`);
  }
}

export function emitChatClientBusEvents(options: {
  prev: ChatClientCoreState;
  next: ChatClientCoreState;
  bus: ExtensionBus;
}): void {
  const { prev, next, bus } = options;
  emitSignedOutEvent(prev, next, bus);
  emitGithubAccountChangedEvent(prev, next, bus);
  emitGithubUserChangedEvent(prev, next, bus);
}

function emitSignedOutEvent(
  prev: ChatClientCoreState,
  next: ChatClientCoreState,
  bus: ExtensionBus,
): void {
  if (prev.authSuppressedByUser !== next.authSuppressedByUser && next.authSuppressedByUser) {
    bus.emit("auth/signedOut", { by: "user" });
  }
}

function emitGithubAccountChangedEvent(
  prev: ChatClientCoreState,
  next: ChatClientCoreState,
  bus: ExtensionBus,
): void {
  if (
    !prev.githubAccountId ||
    !next.githubAccountId ||
    prev.githubAccountId === next.githubAccountId
  ) {
    return;
  }

  bus.emit("auth/githubAccount.changed", {
    prevGithubAccountId: prev.githubAccountId,
    nextGithubAccountId: next.githubAccountId,
  });
}

function emitGithubUserChangedEvent(
  prev: ChatClientCoreState,
  next: ChatClientCoreState,
  bus: ExtensionBus,
): void {
  const prevGithubUserId =
    "user" in prev.publicState ? (prev.publicState.user?.githubUserId ?? null) : null;
  const nextGithubUserId =
    "user" in next.publicState ? (next.publicState.user?.githubUserId ?? null) : null;

  if (prevGithubUserId !== nextGithubUserId) {
    bus.emit("auth/githubUser.changed", { prevGithubUserId, nextGithubUserId });
  }
}
