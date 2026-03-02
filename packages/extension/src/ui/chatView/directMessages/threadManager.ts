import type { AuthUser, DmId, GithubUserId } from "@vscode-chat/protocol";
import { initialDmThreadTrust, type DmThreadTrust } from "../directMessagesTrustPolicy.js";

export type DmThread = {
  dmId: DmId;
  peer: AuthUser;
  trust: DmThreadTrust;
};

export function getOrCreateThread(options: {
  threadsById: Map<DmId, DmThread>;
  dmId: DmId;
  peer: AuthUser;
}): DmThread {
  const { threadsById, dmId, peer } = options;
  const existing = threadsById.get(dmId);
  if (existing) {
    existing.peer = peer;
    return existing;
  }

  const created: DmThread = { dmId, peer, trust: initialDmThreadTrust() };
  threadsById.set(dmId, created);
  return created;
}

export function getPeerForWelcome(options: {
  peersByGithubUserId: Map<GithubUserId, AuthUser>;
  threadsById: Map<DmId, DmThread>;
  dmId: DmId;
  peerGithubUserId: GithubUserId;
}): AuthUser | undefined {
  const { peersByGithubUserId, threadsById, dmId, peerGithubUserId } = options;
  return peersByGithubUserId.get(peerGithubUserId) ?? threadsById.get(dmId)?.peer;
}
