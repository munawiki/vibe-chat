import type { AuthUser, DmId, GithubUserId } from "@vscode-chat/protocol";
import { initialDmThreadTrust } from "../directMessagesTrustPolicy.js";
import type { DmThread } from "./threadManager.js";
import type { DmPeerRegistryDeps } from "./types.js";

export class DmPeerRegistry {
  private readonly peersByGithubUserId = new Map<GithubUserId, AuthUser>();
  private readonly threadsById = new Map<DmId, DmThread>();

  constructor(deps?: DmPeerRegistryDeps) {
    if (deps?.initialPeersByGithubUserId) {
      for (const [githubUserId, peer] of deps.initialPeersByGithubUserId) {
        this.peersByGithubUserId.set(githubUserId, peer);
      }
    }
    if (deps?.initialThreadsById) {
      for (const [dmId, thread] of deps.initialThreadsById) {
        this.threadsById.set(dmId, thread);
      }
    }
  }

  reset(): void {
    this.peersByGithubUserId.clear();
    this.threadsById.clear();
  }

  registerPeer(peer: AuthUser): void {
    this.peersByGithubUserId.set(peer.githubUserId, peer);
  }

  getPeer(githubUserId: GithubUserId): AuthUser | undefined {
    return this.peersByGithubUserId.get(githubUserId);
  }

  getThread(dmId: DmId): DmThread | undefined {
    return this.threadsById.get(dmId);
  }

  getOrCreateThread(dmId: DmId, peer: AuthUser): DmThread {
    const existing = this.threadsById.get(dmId);
    if (existing) {
      existing.peer = peer;
      return existing;
    }

    const created: DmThread = { dmId, peer, trust: initialDmThreadTrust() };
    this.threadsById.set(dmId, created);
    return created;
  }

  getPeerForWelcome(dmId: DmId, peerGithubUserId: GithubUserId): AuthUser | undefined {
    return this.peersByGithubUserId.get(peerGithubUserId) ?? this.threadsById.get(dmId)?.peer;
  }

  listThreads(): DmThread[] {
    return [...this.threadsById.values()];
  }

  getPeersMap(): Map<GithubUserId, AuthUser> {
    return this.peersByGithubUserId;
  }

  getThreadsMap(): Map<DmId, DmThread> {
    return this.threadsById;
  }
}
