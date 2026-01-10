import * as vscode from "vscode";
import type { GitHubSession } from "../core/chatClientCore.js";

const GITHUB_PROVIDER_ID = "github";
const GITHUB_SCOPES = ["read:user"] as const;

export function onDidChangeGitHubSessions(listener: () => void): vscode.Disposable {
  return vscode.authentication.onDidChangeSessions((e) => {
    if (e.provider.id !== GITHUB_PROVIDER_ID) return;
    listener();
  });
}

export async function getGitHubSession(options: {
  interactive: true;
  clearSessionPreference?: boolean;
}): Promise<GitHubSession>;
export async function getGitHubSession(options: {
  interactive: false;
}): Promise<GitHubSession | undefined>;
export async function getGitHubSession(options: {
  interactive: boolean;
  clearSessionPreference?: boolean;
}): Promise<GitHubSession | undefined> {
  const session = options.interactive
    ? await vscode.authentication.getSession(GITHUB_PROVIDER_ID, GITHUB_SCOPES, {
        createIfNone: true,
        ...(options.clearSessionPreference ? { clearSessionPreference: true } : {}),
      })
    : await vscode.authentication.getSession(GITHUB_PROVIDER_ID, GITHUB_SCOPES, { silent: true });

  if (!session) return undefined;
  return { githubAccountId: session.account.id, accessToken: session.accessToken };
}
