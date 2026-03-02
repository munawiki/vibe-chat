import type { AuthUser, DmId, GithubUserId } from "@vscode-chat/protocol";
import type { DmKeypair, DmSecretMigrationDiagnostic } from "../../../e2ee/dmCrypto.js";
import type { DmTrustedKeyStore } from "../directMessagesTrustStore.js";
import type { DmThread } from "./threadManager.js";

export interface DmKeypairScopeDeps {
  readonly secrets: {
    get(key: string): Thenable<string | undefined>;
    store(key: string, value: string): Thenable<void>;
    delete(key: string): Thenable<void>;
  };
  readonly trustedPeerKeys: Pick<DmTrustedKeyStore, "ensureScope" | "reset">;
  readonly onSecretMigrationDiagnostic: (event: DmSecretMigrationDiagnostic) => void;
}

export interface DmPeerRegistryDeps {
  readonly initialPeersByGithubUserId?: ReadonlyMap<GithubUserId, AuthUser>;
  readonly initialThreadsById?: ReadonlyMap<DmId, DmThread>;
}

export interface DmKeypairScopeSnapshot {
  readonly keypair: DmKeypair | undefined;
  readonly signedInGithubUserId: GithubUserId | null;
  readonly scopeVersion: number;
}
