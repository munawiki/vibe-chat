import type * as vscode from "vscode";
import type {
  AuthUser,
  DmId,
  DmIdentity,
  DmMessageCipher,
  GithubUserId,
} from "@vscode-chat/protocol";
import type { ChatClient, ChatClientState } from "../../net/chatClient.js";
import type {
  ExtDmHistoryMsg,
  ExtDmMessageMsg,
  ExtDmStateMsg,
} from "../../contract/protocol/index.js";
import { encryptDmText } from "../../e2ee/dmCrypto.js";
import {
  DM_TRUST_WARNING_BLOCKED,
  approvePendingPeerIdentity,
  canSendDm,
  dmSendBlockedReason,
  toDmThreadView,
  type DmTrustState,
} from "./directMessagesTrustPolicy.js";
import { DmTrustedKeyStore } from "./directMessagesTrustStore.js";
import {
  handleServerMessageNewFlow,
  handleServerWelcomeFlow,
} from "./directMessagesServerFlows.js";
import { emitDmTrustTransitionDiagnostic } from "./directMessagesDiagnostics.js";
import { resolveSignedInConnectedDmAuth } from "./directMessagesAuth.js";
import { DmKeypairScope } from "./directMessages/dmKeypairScope.js";
import { DmPeerRegistry } from "./directMessages/dmPeerRegistry.js";

export type ChatViewDirectMessagesDeps = {
  output: vscode.LogOutputChannel;
  trustedPeerKeys: DmTrustedKeyStore;
  keypairScope: DmKeypairScope;
  peerRegistry: DmPeerRegistry;
};

export class ChatViewDirectMessages {
  private identityPublished = false;

  constructor(private readonly deps: ChatViewDirectMessagesDeps) {}

  reset(): void {
    this.identityPublished = false;
  }

  resetAccountState(): void {
    this.identityPublished = false;
    this.deps.keypairScope.resetAccountState();
    this.deps.peerRegistry.reset();
  }

  getStateMessage(): ExtDmStateMsg {
    return {
      type: "ext/dm.state",
      threads: this.deps.peerRegistry.listThreads().map((thread) => ({
        ...toDmThreadView(thread.trust),
        dmId: thread.dmId,
        peer: thread.peer,
      })),
    };
  }

  async ensureIdentityPublished(client: ChatClient, clientState: ChatClientState): Promise<void> {
    if (this.identityPublished) return;
    if (clientState.authStatus !== "signedIn" || clientState.status !== "connected") return;

    const githubUserId = clientState.user.githubUserId;
    const keypair = await this.getUserKeypairScoped(githubUserId);
    if (this.deps.keypairScope.getSignedInGithubUserId() !== githubUserId) return;

    client.publishDmIdentity(keypair.identity);
    this.identityPublished = true;
  }

  handleUiOpen(
    peer: AuthUser,
    client: ChatClient,
    clientState: ChatClientState,
  ): string | undefined {
    if (clientState.authStatus !== "signedIn" || clientState.status !== "connected") {
      return "Not connected.";
    }
    if (clientState.user.githubUserId === peer.githubUserId) return "Cannot DM self.";

    this.deps.peerRegistry.registerPeer(peer);
    client.openDm(peer.githubUserId);
  }

  handleUiThreadSelect(
    dmId: DmId,
    client: ChatClient,
    clientState: ChatClientState,
  ): string | undefined {
    if (clientState.authStatus !== "signedIn" || clientState.status !== "connected") {
      return "Not connected.";
    }

    const thread = this.deps.peerRegistry.getThread(dmId);
    if (!thread) return "Unknown DM thread.";

    this.deps.peerRegistry.registerPeer(thread.peer);
    client.openDm(thread.peer.githubUserId);
  }

  async handleUiSend(
    dmId: DmId,
    text: string,
    client: ChatClient,
    clientState: ChatClientState,
  ): Promise<string | undefined> {
    if (clientState.authStatus !== "signedIn" || clientState.status !== "connected") {
      return "Not connected.";
    }
    const thread = this.deps.peerRegistry.getThread(dmId);
    if (!thread) return "Unknown DM thread.";
    if (!canSendDm(thread.trust)) return dmSendBlockedReason(thread.trust);
    if (!thread.trust.peerIdentity) return DM_TRUST_WARNING_BLOCKED;
    const keypair = await this.getUserKeypairScoped(clientState.user.githubUserId);
    const encrypted = encryptDmText({
      plaintext: text,
      senderSecretKeyBase64: keypair.secretKeyBase64,
      senderIdentity: keypair.identity,
      recipientIdentity: thread.trust.peerIdentity,
    });
    client.sendDmMessage({
      dmId,
      recipientGithubUserId: thread.peer.githubUserId,
      senderIdentity: keypair.identity,
      recipientIdentity: thread.trust.peerIdentity,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    });
  }

  async handleUiTrustPeerKey(dmId: DmId): Promise<ExtDmStateMsg | undefined> {
    const thread = this.deps.peerRegistry.getThread(dmId);
    if (!thread) return undefined;
    const pending = thread.trust.pendingPeerIdentity;
    if (!pending) return undefined;
    const prevState = thread.trust.state;
    await this.deps.trustedPeerKeys.addTrustedPeerKey(thread.peer.githubUserId, pending.publicKey);
    thread.trust = approvePendingPeerIdentity(thread.trust);
    this.emitTrustTransitionDiagnostic({
      phase: "approve_pending",
      fromState: prevState,
      toState: thread.trust.state,
    });
    return this.getStateMessage();
  }

  async handleServerWelcome(options: {
    event: {
      dmId: DmId;
      peerGithubUserId: GithubUserId;
      peerIdentity?: DmIdentity;
      history: DmMessageCipher[];
    };
    clientState: ChatClientState;
  }): Promise<{ outbound: ExtDmStateMsg[]; history?: ExtDmHistoryMsg; error?: string }> {
    const auth = await resolveSignedInConnectedDmAuth({
      clientState: options.clientState,
      getSignedInGithubUserId: () => this.deps.keypairScope.getSignedInGithubUserId(),
      loadKeypair: (githubUserId) => this.getUserKeypairScoped(githubUserId),
    });
    if (!auth) return { outbound: [this.getStateMessage()] };

    return handleServerWelcomeFlow({
      context: {
        peersByGithubUserId: this.deps.peerRegistry.getPeersMap(),
        threadsById: this.deps.peerRegistry.getThreadsMap(),
        trustedPeerKeys: this.deps.trustedPeerKeys,
        getStateMessage: () => this.getStateMessage(),
        emitTrustTransitionDiagnostic: (args) => this.emitTrustTransitionDiagnostic(args),
        output: this.deps.output,
      },
      event: options.event,
      auth,
    });
  }

  async handleServerMessageNew(options: {
    event: { message: DmMessageCipher };
    clientState: ChatClientState;
  }): Promise<{ outbound: ExtDmStateMsg[]; message?: ExtDmMessageMsg; error?: string }> {
    const auth = await resolveSignedInConnectedDmAuth({
      clientState: options.clientState,
      getSignedInGithubUserId: () => this.deps.keypairScope.getSignedInGithubUserId(),
      loadKeypair: (githubUserId) => this.getUserKeypairScoped(githubUserId),
    });
    if (!auth) return { outbound: [this.getStateMessage()] };

    return handleServerMessageNewFlow({
      context: {
        peersByGithubUserId: this.deps.peerRegistry.getPeersMap(),
        threadsById: this.deps.peerRegistry.getThreadsMap(),
        trustedPeerKeys: this.deps.trustedPeerKeys,
        getStateMessage: () => this.getStateMessage(),
        emitTrustTransitionDiagnostic: (args) => this.emitTrustTransitionDiagnostic(args),
        output: this.deps.output,
      },
      event: options.event,
      auth,
    });
  }

  private async getUserKeypairScoped(githubUserId: GithubUserId) {
    const prevGithubUserId = this.deps.keypairScope.getSignedInGithubUserId();
    const keypair = await this.deps.keypairScope.getUserKeypairScoped(githubUserId);

    if (prevGithubUserId && prevGithubUserId !== githubUserId) {
      this.identityPublished = false;
      this.deps.peerRegistry.reset();
    }

    return keypair;
  }

  private emitTrustTransitionDiagnostic(options: {
    phase: "observe_peer_identity" | "approve_pending";
    fromState: DmTrustState;
    toState: DmTrustState;
  }): void {
    emitDmTrustTransitionDiagnostic({
      output: this.deps.output,
      phase: options.phase,
      fromState: options.fromState,
      toState: options.toState,
    });
  }
}
