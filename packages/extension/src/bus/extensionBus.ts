import mitt, { type Emitter } from "mitt";
import type { GithubUserId } from "@vscode-chat/protocol";

export type ExtensionBusEvents = {
  "auth/signedOut": { by: "user" };
  "auth/githubAccount.changed": {
    prevGithubAccountId: string | undefined;
    nextGithubAccountId: string | undefined;
  };
  "auth/githubUser.changed": {
    prevGithubUserId: GithubUserId | null;
    nextGithubUserId: GithubUserId | null;
  };
};

export type ExtensionBus = Emitter<ExtensionBusEvents>;

export function createExtensionBus(): ExtensionBus {
  return mitt<ExtensionBusEvents>();
}
