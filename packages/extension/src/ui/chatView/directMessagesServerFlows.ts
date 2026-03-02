import type {
  AuthUser,
  DmId,
  DmIdentity,
  DmMessageCipher,
  DmMessagePlain,
  GithubUserId,
} from "@vscode-chat/protocol";
import type {
  ExtDmHistoryMsg,
  ExtDmMessageMsg,
  ExtDmStateMsg,
} from "../../contract/protocol/index.js";
import { decryptDmText, type DmKeypair } from "../../e2ee/dmCrypto.js";
import {
  applyPeerIdentityFromMessage,
  applyWelcomePeerIdentity,
  pickIdentityByPublicKey,
} from "./directMessages/peerIdentity.js";
import {
  getOrCreateThread,
  getPeerForWelcome,
  type DmThread,
} from "./directMessages/threadManager.js";
import { DmTrustedKeyStore } from "./directMessagesTrustStore.js";

export interface DmFlowContext {
  peersByGithubUserId: Map<GithubUserId, AuthUser>;
  threadsById: Map<DmId, DmThread>;
  trustedPeerKeys: DmTrustedKeyStore;
  getStateMessage: () => ExtDmStateMsg;
  emitTrustTransitionDiagnostic: (options: {
    phase: "observe_peer_identity" | "approve_pending";
    fromState: import("./directMessagesTrustPolicy.js").DmTrustState;
    toState: import("./directMessagesTrustPolicy.js").DmTrustState;
  }) => void;
  output: { warn: (message: string) => void };
}

export async function handleServerWelcomeFlow(options: {
  context: DmFlowContext;
  event: {
    dmId: DmId;
    peerGithubUserId: GithubUserId;
    peerIdentity?: DmIdentity;
    history: DmMessageCipher[];
  };
  auth: { githubUserId: GithubUserId; keypair: DmKeypair };
}): Promise<{ outbound: ExtDmStateMsg[]; history?: ExtDmHistoryMsg; error?: string }> {
  const peer = getPeerForWelcome({
    peersByGithubUserId: options.context.peersByGithubUserId,
    threadsById: options.context.threadsById,
    dmId: options.event.dmId,
    peerGithubUserId: options.event.peerGithubUserId,
  });

  if (!peer) {
    options.context.output.warn(
      `dm welcome ignored: missing peer for githubUserId=${options.event.peerGithubUserId}`,
    );
    return { outbound: [options.context.getStateMessage()], error: "Missing DM peer identity." };
  }

  const thread = getOrCreateThread({
    threadsById: options.context.threadsById,
    dmId: options.event.dmId,
    peer,
  });

  await applyWelcomePeerIdentity({
    thread,
    peerGithubUserId: peer.githubUserId,
    peerIdentity: options.event.peerIdentity,
    trustedPeerKeys: options.context.trustedPeerKeys,
    emitTrustTransitionDiagnostic: options.context.emitTrustTransitionDiagnostic,
  });

  const decrypted: DmMessagePlain[] = [];
  for (const msg of options.event.history) {
    const decoded = decryptDmText({
      message: msg,
      receiverSecretKeyBase64: options.auth.keypair.secretKeyBase64,
      receiverPublicKeyBase64: options.auth.keypair.identity.publicKey,
    });
    if (!decoded.ok) continue;

    const peerIdentityFromMsg = pickIdentityByPublicKey(msg, decoded.peerIdentityPublicKey);
    if (peerIdentityFromMsg) {
      await applyPeerIdentityFromMessage({
        thread,
        peerGithubUserId: peer.githubUserId,
        peerIdentity: peerIdentityFromMsg,
        trustedPeerKeys: options.context.trustedPeerKeys,
        emitTrustTransitionDiagnostic: options.context.emitTrustTransitionDiagnostic,
      });
    }

    decrypted.push({
      id: msg.id,
      dmId: msg.dmId,
      user: msg.sender,
      text: decoded.plaintext,
      createdAt: msg.createdAt,
    });
  }

  return {
    outbound: [options.context.getStateMessage()],
    history: { type: "ext/dm.history", dmId: options.event.dmId, history: decrypted },
  };
}

export async function handleServerMessageNewFlow(options: {
  context: DmFlowContext;
  event: { message: DmMessageCipher };
  auth: { githubUserId: GithubUserId; keypair: DmKeypair };
}): Promise<{ outbound: ExtDmStateMsg[]; message?: ExtDmMessageMsg; error?: string }> {
  const msg = options.event.message;

  const peerGithubUserId =
    msg.sender.githubUserId === options.auth.githubUserId
      ? msg.recipientGithubUserId
      : msg.sender.githubUserId;

  const peer =
    peerGithubUserId === msg.sender.githubUserId
      ? msg.sender
      : (options.context.peersByGithubUserId.get(peerGithubUserId) ??
        options.context.threadsById.get(msg.dmId)?.peer);

  if (!peer) {
    return { outbound: [options.context.getStateMessage()], error: "Missing DM peer." };
  }

  const thread = getOrCreateThread({
    threadsById: options.context.threadsById,
    dmId: msg.dmId,
    peer,
  });

  const decoded = decryptDmText({
    message: msg,
    receiverSecretKeyBase64: options.auth.keypair.secretKeyBase64,
    receiverPublicKeyBase64: options.auth.keypair.identity.publicKey,
  });

  if (!decoded.ok) {
    options.context.output.warn(
      `dm decrypt failed: dmId=${msg.dmId} from=${msg.sender.githubUserId} error=${decoded.error}`,
    );
    return {
      outbound: [options.context.getStateMessage()],
      error: "Failed to decrypt DM message.",
    };
  }

  const peerIdentityFromMsg = pickIdentityByPublicKey(msg, decoded.peerIdentityPublicKey);
  if (peerIdentityFromMsg) {
    await applyPeerIdentityFromMessage({
      thread,
      peerGithubUserId,
      peerIdentity: peerIdentityFromMsg,
      trustedPeerKeys: options.context.trustedPeerKeys,
      emitTrustTransitionDiagnostic: options.context.emitTrustTransitionDiagnostic,
    });
  }

  const plaintext: DmMessagePlain = {
    id: msg.id,
    dmId: msg.dmId,
    user: msg.sender,
    text: decoded.plaintext,
    createdAt: msg.createdAt,
  };

  return {
    outbound: [options.context.getStateMessage()],
    message: { type: "ext/dm.message", message: plaintext },
  };
}
