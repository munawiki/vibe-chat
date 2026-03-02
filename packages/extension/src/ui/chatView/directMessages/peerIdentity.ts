import type { DmIdentity, DmMessageCipher, GithubUserId } from "@vscode-chat/protocol";
import { applyObservedPeerIdentity, type DmTrustState } from "../directMessagesTrustPolicy.js";
import { DmTrustedKeyStore } from "../directMessagesTrustStore.js";
import type { DmThread } from "./threadManager.js";

export async function applyWelcomePeerIdentity(options: {
  thread: DmThread;
  peerGithubUserId: GithubUserId;
  peerIdentity: DmIdentity | undefined;
  trustedPeerKeys: DmTrustedKeyStore;
  emitTrustTransitionDiagnostic: (options: {
    phase: "observe_peer_identity" | "approve_pending";
    fromState: DmTrustState;
    toState: DmTrustState;
  }) => void;
}): Promise<void> {
  const { thread, peerGithubUserId, peerIdentity } = options;

  if (!peerIdentity) {
    const prevState = thread.trust.state;
    thread.trust = applyObservedPeerIdentity(thread.trust, { kind: "missing" });
    options.emitTrustTransitionDiagnostic({
      phase: "observe_peer_identity",
      fromState: prevState,
      toState: thread.trust.state,
    });
    return;
  }

  await applyObservedPeerIdentityToThread({
    thread,
    peerGithubUserId,
    peerIdentity,
    trustedPeerKeys: options.trustedPeerKeys,
    emitTrustTransitionDiagnostic: options.emitTrustTransitionDiagnostic,
  });
}

export async function applyPeerIdentityFromMessage(options: {
  thread: DmThread;
  peerGithubUserId: GithubUserId;
  peerIdentity: DmIdentity;
  trustedPeerKeys: DmTrustedKeyStore;
  emitTrustTransitionDiagnostic: (options: {
    phase: "observe_peer_identity" | "approve_pending";
    fromState: DmTrustState;
    toState: DmTrustState;
  }) => void;
}): Promise<void> {
  await applyObservedPeerIdentityToThread(options);
}

export async function applyObservedPeerIdentityToThread(options: {
  thread: DmThread;
  peerGithubUserId: GithubUserId;
  peerIdentity: DmIdentity;
  trustedPeerKeys: DmTrustedKeyStore;
  emitTrustTransitionDiagnostic: (options: {
    phase: "observe_peer_identity" | "approve_pending";
    fromState: DmTrustState;
    toState: DmTrustState;
  }) => void;
}): Promise<void> {
  const { thread, peerGithubUserId, peerIdentity, trustedPeerKeys, emitTrustTransitionDiagnostic } =
    options;

  const prevState = thread.trust.state;
  const observed = await trustedPeerKeys.observePeerKey(peerGithubUserId, peerIdentity.publicKey);
  thread.trust = applyObservedPeerIdentity(
    thread.trust,
    observed.trusted
      ? { kind: "trusted", identity: peerIdentity }
      : { kind: "untrusted", identity: peerIdentity },
  );

  emitTrustTransitionDiagnostic({
    phase: "observe_peer_identity",
    fromState: prevState,
    toState: thread.trust.state,
  });
}

export function pickIdentityByPublicKey(
  message: Pick<DmMessageCipher, "senderIdentity" | "recipientIdentity">,
  publicKey: string,
): DmIdentity | undefined {
  if (message.senderIdentity.publicKey === publicKey) return message.senderIdentity;
  if (message.recipientIdentity.publicKey === publicKey) return message.recipientIdentity;
  return undefined;
}
