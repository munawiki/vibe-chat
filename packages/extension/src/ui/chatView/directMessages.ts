import * as vscode from "vscode";
import type {
  AuthUser,
  DmId,
  DmIdentity,
  DmMessageCipher,
  DmMessagePlain,
  GithubUserId,
} from "@vscode-chat/protocol";
import type { ChatClient, ChatClientState } from "../../net/chatClient.js";
import type {
  ExtDmHistoryMsg,
  ExtDmMessageMsg,
  ExtDmStateMsg,
} from "../../contract/webviewProtocol.js";
import {
  decryptDmText,
  encryptDmText,
  getOrCreateDmKeypair,
  type DmKeypair,
  type DmSecretMigrationDiagnostic,
} from "../../e2ee/dmCrypto.js";
import {
  DM_TRUST_WARNING_BLOCKED,
  applyObservedPeerIdentity,
  approvePendingPeerIdentity,
  canSendDm,
  dmSendBlockedReason,
  initialDmThreadTrust,
  toDmThreadView,
  type DmTrustState,
  type DmThreadTrust,
} from "./directMessagesTrustPolicy.js";
import { DmTrustedKeyStore } from "./directMessagesTrustStore.js";

type DmThread = {
  dmId: DmId;
  peer: AuthUser;
  trust: DmThreadTrust;
};

export class ChatViewDirectMessages {
  private static readonly DM_SECRET_MIGRATION_DIAG = "dm secret migration";
  private static readonly DM_TRUST_TRANSITION_DIAG = "dm trust transition";

  private identityPublished = false;
  private keypair: DmKeypair | undefined;
  private signedInGithubUserId: GithubUserId | null = null;
  private scopeVersion = 0;

  private readonly peersByGithubUserId = new Map<GithubUserId, AuthUser>();
  private readonly threadsById = new Map<DmId, DmThread>();
  private readonly trustedPeerKeys: DmTrustedKeyStore;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {
    this.trustedPeerKeys = new DmTrustedKeyStore(this.context.globalState, this.output);
  }

  reset(): void {
    this.identityPublished = false;
  }

  resetAccountState(): void {
    this.identityPublished = false;
    this.keypair = undefined;
    this.signedInGithubUserId = null;
    this.scopeVersion += 1;
    this.peersByGithubUserId.clear();
    this.threadsById.clear();
    this.trustedPeerKeys.reset();
  }

  getStateMessage(): ExtDmStateMsg {
    return {
      type: "ext/dm.state",
      threads: [...this.threadsById.values()].map((thread) => ({
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
    if (this.signedInGithubUserId !== githubUserId) return;
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

    this.peersByGithubUserId.set(peer.githubUserId, peer);
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

    const thread = this.threadsById.get(dmId);
    if (!thread) return "Unknown DM thread.";

    this.peersByGithubUserId.set(thread.peer.githubUserId, thread.peer);
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

    const thread = this.threadsById.get(dmId);
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
    const thread = this.threadsById.get(dmId);
    if (!thread) return undefined;

    const pending = thread.trust.pendingPeerIdentity;
    if (!pending) return undefined;

    const prevState = thread.trust.state;
    await this.trustedPeerKeys.addTrustedPeerKey(thread.peer.githubUserId, pending.publicKey);
    thread.trust = approvePendingPeerIdentity(thread.trust);
    this.emitTrustTransitionDiagnostic({
      phase: "approve_pending",
      fromState: prevState,
      toState: thread.trust.state,
    });

    return this.getStateMessage();
  }

  private async getSignedInConnectedKeypair(
    clientState: ChatClientState,
  ): Promise<{ githubUserId: GithubUserId; keypair: DmKeypair } | undefined> {
    if (clientState.authStatus !== "signedIn" || clientState.status !== "connected") return;
    const githubUserId = clientState.user.githubUserId;
    const keypair = await this.getUserKeypairScoped(githubUserId);
    if (this.signedInGithubUserId !== githubUserId) return;
    return { githubUserId, keypair };
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
    const auth = await this.getSignedInConnectedKeypair(options.clientState);
    if (!auth) return { outbound: [this.getStateMessage()] };
    const { keypair } = auth;

    const peer = this.getPeerForWelcome(options.event.dmId, options.event.peerGithubUserId);
    if (!peer) {
      this.output.warn(
        `dm welcome ignored: missing peer for githubUserId=${options.event.peerGithubUserId}`,
      );
      return { outbound: [this.getStateMessage()], error: "Missing DM peer identity." };
    }

    const thread = this.getOrCreateThread(options.event.dmId, peer);

    await this.applyWelcomePeerIdentity(thread, peer.githubUserId, options.event.peerIdentity);

    const decrypted: DmMessagePlain[] = [];
    for (const msg of options.event.history) {
      const decoded = decryptDmText({
        message: msg,
        receiverSecretKeyBase64: keypair.secretKeyBase64,
        receiverPublicKeyBase64: keypair.identity.publicKey,
      });
      if (!decoded.ok) continue;

      const peerIdentityFromMsg = pickIdentityByPublicKey(msg, decoded.peerIdentityPublicKey);
      if (peerIdentityFromMsg) {
        await this.applyPeerIdentityFromMessage(thread, peer.githubUserId, peerIdentityFromMsg);
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
      outbound: [this.getStateMessage()],
      history: { type: "ext/dm.history", dmId: options.event.dmId, history: decrypted },
    };
  }

  private getPeerForWelcome(dmId: DmId, peerGithubUserId: GithubUserId): AuthUser | undefined {
    return this.peersByGithubUserId.get(peerGithubUserId) ?? this.threadsById.get(dmId)?.peer;
  }

  private async applyWelcomePeerIdentity(
    thread: DmThread,
    peerGithubUserId: GithubUserId,
    peerIdentity: DmIdentity | undefined,
  ): Promise<void> {
    if (!peerIdentity) {
      const prevState = thread.trust.state;
      thread.trust = applyObservedPeerIdentity(thread.trust, { kind: "missing" });
      this.emitTrustTransitionDiagnostic({
        phase: "observe_peer_identity",
        fromState: prevState,
        toState: thread.trust.state,
      });
      return;
    }

    await this.applyObservedPeerIdentity(thread, peerGithubUserId, peerIdentity);
  }

  private async applyPeerIdentityFromMessage(
    thread: DmThread,
    peerGithubUserId: GithubUserId,
    peerIdentity: DmIdentity,
  ): Promise<void> {
    await this.applyObservedPeerIdentity(thread, peerGithubUserId, peerIdentity);
  }

  async handleServerMessageNew(options: {
    event: { message: DmMessageCipher };
    clientState: ChatClientState;
  }): Promise<{ outbound: ExtDmStateMsg[]; message?: ExtDmMessageMsg; error?: string }> {
    const auth = await this.getSignedInConnectedKeypair(options.clientState);
    if (!auth) return { outbound: [this.getStateMessage()] };
    const { githubUserId, keypair } = auth;
    const msg = options.event.message;

    const peerGithubUserId =
      msg.sender.githubUserId === githubUserId
        ? msg.recipientGithubUserId
        : msg.sender.githubUserId;

    const peer =
      peerGithubUserId === msg.sender.githubUserId
        ? msg.sender
        : (this.peersByGithubUserId.get(peerGithubUserId) ?? this.threadsById.get(msg.dmId)?.peer);
    if (!peer) return { outbound: [this.getStateMessage()], error: "Missing DM peer." };

    const thread = this.getOrCreateThread(msg.dmId, peer);

    const decoded = decryptDmText({
      message: msg,
      receiverSecretKeyBase64: keypair.secretKeyBase64,
      receiverPublicKeyBase64: keypair.identity.publicKey,
    });
    if (!decoded.ok) {
      this.output.warn(
        `dm decrypt failed: dmId=${msg.dmId} from=${msg.sender.githubUserId} error=${decoded.error}`,
      );
      return { outbound: [this.getStateMessage()], error: "Failed to decrypt DM message." };
    }

    const peerKeyPublic = decoded.peerIdentityPublicKey;
    const peerIdentityFromMsg = pickIdentityByPublicKey(msg, peerKeyPublic);
    if (peerIdentityFromMsg) {
      await this.applyPeerIdentityFromMessage(thread, peerGithubUserId, peerIdentityFromMsg);
    }

    const plaintext: DmMessagePlain = {
      id: msg.id,
      dmId: msg.dmId,
      user: msg.sender,
      text: decoded.plaintext,
      createdAt: msg.createdAt,
    };

    return {
      outbound: [this.getStateMessage()],
      message: { type: "ext/dm.message", message: plaintext },
    };
  }

  private async ensureUserScope(githubUserId: GithubUserId): Promise<void> {
    if (this.signedInGithubUserId === githubUserId) return;
    if (this.signedInGithubUserId !== null) {
      this.resetAccountState();
    }
    this.signedInGithubUserId = githubUserId;
    this.scopeVersion += 1;
    await this.trustedPeerKeys.ensureScope(githubUserId);
  }

  private async getKeypair(githubUserId: GithubUserId): Promise<DmKeypair> {
    if (this.keypair && this.signedInGithubUserId === githubUserId) return this.keypair;
    const scopeVersion = this.scopeVersion;
    const loaded = await getOrCreateDmKeypair({
      githubUserId,
      secrets: this.context.secrets,
      onDiagnostic: (event) => this.emitSecretMigrationDiagnostic(event),
    });
    if (this.signedInGithubUserId !== githubUserId || this.scopeVersion !== scopeVersion) {
      return loaded;
    }
    this.keypair = loaded;
    return this.keypair;
  }

  private async getUserKeypairScoped(githubUserId: GithubUserId): Promise<DmKeypair> {
    await this.ensureUserScope(githubUserId);
    return this.getKeypair(githubUserId);
  }

  private getOrCreateThread(dmId: DmId, peer: AuthUser): DmThread {
    const existing = this.threadsById.get(dmId);
    if (existing) {
      existing.peer = peer;
      return existing;
    }
    const created: DmThread = { dmId, peer, trust: initialDmThreadTrust() };
    this.threadsById.set(dmId, created);
    return created;
  }

  private async applyObservedPeerIdentity(
    thread: DmThread,
    peerGithubUserId: GithubUserId,
    peerIdentity: DmIdentity,
  ): Promise<void> {
    const prevState = thread.trust.state;
    const observed = await this.trustedPeerKeys.observePeerKey(
      peerGithubUserId,
      peerIdentity.publicKey,
    );
    thread.trust = applyObservedPeerIdentity(
      thread.trust,
      observed.trusted
        ? { kind: "trusted", identity: peerIdentity }
        : { kind: "untrusted", identity: peerIdentity },
    );
    this.emitTrustTransitionDiagnostic({
      phase: "observe_peer_identity",
      fromState: prevState,
      toState: thread.trust.state,
    });
  }

  private emitSecretMigrationDiagnostic(event: DmSecretMigrationDiagnostic): void {
    const serialized = JSON.stringify({
      boundary: event.boundary,
      phase: event.phase,
      outcome: event.outcome,
      ...(event.errorClass ? { errorClass: event.errorClass } : {}),
    });
    const text = `${ChatViewDirectMessages.DM_SECRET_MIGRATION_DIAG}: ${serialized}`;
    if (event.outcome === "failed") this.output.warn(text);
    else this.output.info(text);
  }

  private emitTrustTransitionDiagnostic(options: {
    phase: "observe_peer_identity" | "approve_pending";
    fromState: DmTrustState;
    toState: DmTrustState;
  }): void {
    const serialized = JSON.stringify({
      boundary: "dm.trust.transition",
      phase: options.phase,
      outcome: options.fromState === options.toState ? "no_change" : "transitioned",
      fromState: options.fromState,
      toState: options.toState,
    });
    this.output.info(`${ChatViewDirectMessages.DM_TRUST_TRANSITION_DIAG}: ${serialized}`);
  }
}

function pickIdentityByPublicKey(
  message: Pick<DmMessageCipher, "senderIdentity" | "recipientIdentity">,
  publicKey: string,
): DmIdentity | undefined {
  if (message.senderIdentity.publicKey === publicKey) return message.senderIdentity;
  if (message.recipientIdentity.publicKey === publicKey) return message.recipientIdentity;
  return undefined;
}
