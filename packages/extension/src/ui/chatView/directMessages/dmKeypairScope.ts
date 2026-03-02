import type { GithubUserId } from "@vscode-chat/protocol";
import { getOrCreateDmKeypair, type DmKeypair } from "../../../e2ee/dmCrypto.js";
import type { DmKeypairScopeDeps, DmKeypairScopeSnapshot } from "./types.js";

export class DmKeypairScope {
  private keypair: DmKeypair | undefined;
  private signedInGithubUserId: GithubUserId | null = null;
  private scopeVersion = 0;

  constructor(private readonly deps: DmKeypairScopeDeps) {}

  resetAccountState(): void {
    this.keypair = undefined;
    this.signedInGithubUserId = null;
    this.scopeVersion += 1;
    this.deps.trustedPeerKeys.reset();
  }

  getSignedInGithubUserId(): GithubUserId | null {
    return this.signedInGithubUserId;
  }

  getSnapshot(): DmKeypairScopeSnapshot {
    return {
      keypair: this.keypair,
      signedInGithubUserId: this.signedInGithubUserId,
      scopeVersion: this.scopeVersion,
    };
  }

  async getUserKeypairScoped(githubUserId: GithubUserId): Promise<DmKeypair> {
    if (this.signedInGithubUserId !== githubUserId) {
      if (this.signedInGithubUserId !== null) {
        this.resetAccountState();
      }
      this.signedInGithubUserId = githubUserId;
      this.scopeVersion += 1;
      await this.deps.trustedPeerKeys.ensureScope(githubUserId);
    }

    if (this.keypair && this.signedInGithubUserId === githubUserId) {
      return this.keypair;
    }

    const scopeVersion = this.scopeVersion;
    const loaded = await getOrCreateDmKeypair({
      githubUserId,
      secrets: this.deps.secrets,
      onDiagnostic: (event) => this.deps.onSecretMigrationDiagnostic(event),
    });

    if (this.signedInGithubUserId !== githubUserId || this.scopeVersion !== scopeVersion) {
      return loaded;
    }

    this.keypair = loaded;
    return loaded;
  }
}
