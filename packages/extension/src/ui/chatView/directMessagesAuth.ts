import type { GithubUserId } from "@vscode-chat/protocol";
import type { ChatClientState } from "../../net/chatClient.js";

export async function resolveSignedInConnectedDmAuth<Keypair>(options: {
  clientState: ChatClientState;
  getSignedInGithubUserId: () => GithubUserId | null;
  loadKeypair: (githubUserId: GithubUserId) => Promise<Keypair>;
}): Promise<{ githubUserId: GithubUserId; keypair: Keypair } | undefined> {
  if (options.clientState.authStatus !== "signedIn" || options.clientState.status !== "connected") {
    return undefined;
  }

  const githubUserId = options.clientState.user.githubUserId;
  const keypair = await options.loadKeypair(githubUserId);
  if (options.getSignedInGithubUserId() !== githubUserId) return undefined;
  return { githubUserId, keypair };
}
