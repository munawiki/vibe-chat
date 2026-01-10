import * as vscode from "vscode";
import { z } from "zod";
import type {
  AuthUser,
  DmId,
  DmIdentity,
  DmMessageCipher,
  DmMessagePlain,
  GithubUserId,
} from "@vscode-chat/protocol";
import { GithubUserIdSchema } from "@vscode-chat/protocol";
import type { ChatClientState } from "../../net/chatClient.js";
import type { ChatClient } from "../../net/chatClient.js";
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
} from "../../e2ee/dmCrypto.js";

const TRUSTED_PEER_KEYS_STORAGE_KEY_V1 = "vscodeChat.dm.trustedPeerKeys.v1";
const TRUSTED_PEER_KEYS_STORAGE_KEY_V2_PREFIX = "vscodeChat.dm.trustedPeerKeys.v2:";

function trustedPeerKeysStorageKeyV2(githubUserId: GithubUserId): string {
  return `${TRUSTED_PEER_KEYS_STORAGE_KEY_V2_PREFIX}${githubUserId}`;
}

const TrustedPeerKeysSchema = z.record(z.string(), z.array(z.string().min(1)));

type DmThread = {
  dmId: DmId;
  peer: AuthUser;
  peerIdentity?: DmIdentity;
  pendingPeerIdentity?: DmIdentity;
  isBlocked: boolean;
  warning?: string;
};

export class ChatViewDirectMessages {
  private identityPublished = false;
  private keypair: DmKeypair | undefined;
  private signedInGithubUserId: GithubUserId | null = null;
  private trustedPeerKeysLoadedForGithubUserId: GithubUserId | null = null;

  private readonly peersByGithubUserId = new Map<GithubUserId, AuthUser>();
  private readonly threadsById = new Map<DmId, DmThread>();
  private readonly trustedPeerKeysByGithubUserId = new Map<GithubUserId, Set<string>>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {
    // trusted peer keys are loaded lazily per signed-in user id
  }

  reset(): void {
    this.identityPublished = false;
  }

  resetAccountState(): void {
    this.identityPublished = false;
    this.keypair = undefined;
    this.signedInGithubUserId = null;
    this.trustedPeerKeysLoadedForGithubUserId = null;
    this.peersByGithubUserId.clear();
    this.threadsById.clear();
    this.trustedPeerKeysByGithubUserId.clear();
  }

  getStateMessage(): ExtDmStateMsg {
    return {
      type: "ext/dm.state",
      threads: [...this.threadsById.values()].map((thread) => ({
        dmId: thread.dmId,
        peer: thread.peer,
        isBlocked: thread.isBlocked,
        canTrustKey: !!thread.pendingPeerIdentity,
        ...(thread.warning ? { warning: thread.warning } : {}),
      })),
    };
  }

  async ensureIdentityPublished(client: ChatClient, clientState: ChatClientState): Promise<void> {
    if (this.identityPublished) return;
    if (clientState.authStatus !== "signedIn" || clientState.status !== "connected") return;
    const keypair = await this.getUserKeypairScoped(clientState.user.githubUserId);
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
    return;
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
    return;
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
    if (thread.isBlocked) return thread.warning ?? "DM is blocked.";
    if (!thread.peerIdentity) return "Peer key unavailable.";

    const keypair = await this.getUserKeypairScoped(clientState.user.githubUserId);
    const encrypted = encryptDmText({
      plaintext: text,
      senderSecretKeyBase64: keypair.secretKeyBase64,
      senderIdentity: keypair.identity,
      recipientIdentity: thread.peerIdentity,
    });

    client.sendDmMessage({
      dmId,
      recipientGithubUserId: thread.peer.githubUserId,
      senderIdentity: keypair.identity,
      recipientIdentity: thread.peerIdentity,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    });

    return;
  }

  async handleUiTrustPeerKey(dmId: DmId): Promise<ExtDmStateMsg | undefined> {
    const thread = this.threadsById.get(dmId);
    if (!thread) return undefined;

    const pending = thread.pendingPeerIdentity;
    if (!pending) return undefined;

    await this.addTrustedPeerKey(thread.peer.githubUserId, pending.publicKey);
    thread.isBlocked = false;
    delete thread.warning;
    thread.peerIdentity = pending;
    delete thread.pendingPeerIdentity;

    return this.getStateMessage();
  }

  private async getSignedInConnectedKeypair(
    clientState: ChatClientState,
  ): Promise<{ githubUserId: GithubUserId; keypair: DmKeypair } | undefined> {
    if (clientState.authStatus !== "signedIn" || clientState.status !== "connected") return;
    const githubUserId = clientState.user.githubUserId;
    const keypair = await this.getUserKeypairScoped(githubUserId);
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

    const peer =
      this.peersByGithubUserId.get(options.event.peerGithubUserId) ??
      this.threadsById.get(options.event.dmId)?.peer;
    if (!peer) {
      this.output.warn(
        `dm welcome ignored: missing peer for githubUserId=${options.event.peerGithubUserId}`,
      );
      return { outbound: [this.getStateMessage()], error: "Missing DM peer identity." };
    }

    const thread = this.getOrCreateThread(options.event.dmId, peer);

    const peerIdentity = options.event.peerIdentity;
    if (!peerIdentity) {
      thread.isBlocked = true;
      thread.warning = "Peer key unavailable.";
      delete thread.peerIdentity;
      delete thread.pendingPeerIdentity;
    } else {
      const trust = await this.observePeerKey(peer.githubUserId, peerIdentity);
      if (!trust.trusted) {
        thread.isBlocked = true;
        thread.warning = "Peer key changed. Trust the new key to continue.";
        thread.pendingPeerIdentity = peerIdentity;
      } else {
        thread.peerIdentity = peerIdentity;
        thread.isBlocked = false;
        delete thread.warning;
        delete thread.pendingPeerIdentity;
      }
    }

    const decrypted: DmMessagePlain[] = [];
    for (const msg of options.event.history) {
      const decoded = decryptDmText({
        message: msg,
        receiverSecretKeyBase64: keypair.secretKeyBase64,
        receiverPublicKeyBase64: keypair.identity.publicKey,
      });
      if (!decoded.ok) continue;

      const peerKeyPublic = decoded.peerIdentityPublicKey;
      const peerIdentityFromMsg = pickIdentityByPublicKey(msg, peerKeyPublic);
      if (peerIdentityFromMsg) {
        const trust = await this.observePeerKey(peer.githubUserId, peerIdentityFromMsg);
        if (!trust.trusted) {
          thread.isBlocked = true;
          thread.warning = "Peer key changed. Trust the new key to continue.";
          thread.pendingPeerIdentity = peerIdentityFromMsg;
        } else if (!thread.pendingPeerIdentity) {
          thread.peerIdentity = peerIdentityFromMsg;
          if (thread.warning === "Peer key unavailable.") {
            thread.isBlocked = false;
            delete thread.warning;
          }
        }
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
      const trust = await this.observePeerKey(peerGithubUserId, peerIdentityFromMsg);
      if (!trust.trusted) {
        thread.isBlocked = true;
        thread.warning = "Peer key changed. Trust the new key to continue.";
        thread.pendingPeerIdentity = peerIdentityFromMsg;
      } else {
        thread.peerIdentity = peerIdentityFromMsg;
        if (!thread.pendingPeerIdentity) {
          thread.isBlocked = false;
          delete thread.warning;
        }
      }
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
    await this.loadTrustedPeerKeys(githubUserId);
  }

  private async getKeypair(githubUserId: GithubUserId): Promise<DmKeypair> {
    if (this.keypair && this.signedInGithubUserId === githubUserId) return this.keypair;
    this.keypair = await getOrCreateDmKeypair({
      githubUserId,
      secrets: this.context.secrets,
    });
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
    const created: DmThread = { dmId, peer, isBlocked: false };
    this.threadsById.set(dmId, created);
    return created;
  }

  private async loadTrustedPeerKeys(githubUserId: GithubUserId): Promise<void> {
    if (this.trustedPeerKeysLoadedForGithubUserId === githubUserId) return;
    this.trustedPeerKeysByGithubUserId.clear();

    const v2Key = trustedPeerKeysStorageKeyV2(githubUserId);
    let raw = this.context.globalState.get<unknown>(v2Key);

    if (raw === undefined) {
      const v1Raw = this.context.globalState.get<unknown>(TRUSTED_PEER_KEYS_STORAGE_KEY_V1);
      const v1Parsed = TrustedPeerKeysSchema.safeParse(v1Raw);
      if (v1Parsed.success) {
        raw = v1Parsed.data;
        try {
          await this.context.globalState.update(v2Key, v1Parsed.data);
          await this.context.globalState.update(TRUSTED_PEER_KEYS_STORAGE_KEY_V1, undefined);
        } catch (err) {
          this.output.warn(`dm trusted keys migration failed: ${String(err)}`);
        }
      }
    }

    const parsed = TrustedPeerKeysSchema.safeParse(raw);
    if (!parsed.success) {
      this.trustedPeerKeysLoadedForGithubUserId = githubUserId;
      return;
    }

    for (const [githubUserId, keys] of Object.entries(parsed.data)) {
      const githubUserIdParsed = GithubUserIdSchema.safeParse(githubUserId);
      if (!githubUserIdParsed.success) continue;
      this.trustedPeerKeysByGithubUserId.set(githubUserIdParsed.data, new Set(keys));
    }

    this.trustedPeerKeysLoadedForGithubUserId = githubUserId;
  }

  private async addTrustedPeerKey(githubUserId: GithubUserId, publicKey: string): Promise<void> {
    const set = this.trustedPeerKeysByGithubUserId.get(githubUserId) ?? new Set<string>();
    set.add(publicKey);
    this.trustedPeerKeysByGithubUserId.set(githubUserId, set);
    await this.persistTrustedPeerKeys();
  }

  private async observePeerKey(
    githubUserId: GithubUserId,
    identity: DmIdentity,
  ): Promise<{ trusted: boolean }> {
    const set = this.trustedPeerKeysByGithubUserId.get(githubUserId);
    if (!set || set.size === 0) {
      await this.addTrustedPeerKey(githubUserId, identity.publicKey);
      return { trusted: true };
    }
    return { trusted: set.has(identity.publicKey) };
  }

  private async persistTrustedPeerKeys(): Promise<void> {
    if (!this.signedInGithubUserId) return;
    const out: Record<string, string[]> = {};
    for (const [githubUserId, keys] of this.trustedPeerKeysByGithubUserId) {
      out[githubUserId] = [...keys];
    }
    await this.context.globalState.update(
      trustedPeerKeysStorageKeyV2(this.signedInGithubUserId),
      out,
    );
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
