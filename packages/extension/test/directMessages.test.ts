import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { AuthUserSchema, DmIdSchema } from "@vscode-chat/protocol";
import type { AuthUser, DmIdentity, DmMessageCipher } from "@vscode-chat/protocol";
import nacl from "tweetnacl";
import type { ChatClient } from "../src/net/chatClient.js";
import type { ChatClientState } from "../src/net/chatClient.js";
import {
  DM_SECRET_STORAGE_KEY_V1,
  decryptDmText,
  dmSecretStorageKeyV2,
  encryptDmText,
  getOrCreateDmKeypair,
} from "../src/e2ee/dmCrypto.js";
import { ChatViewDirectMessages } from "../src/ui/chatView/directMessages.js";

function createMemoryContext(): {
  context: {
    secrets: {
      get(key: string): Thenable<string | undefined>;
      store(key: string, value: string): Thenable<void>;
      delete(key: string): Thenable<void>;
    };
    globalState: {
      get<T>(key: string): T | undefined;
      update(key: string, value: unknown): Thenable<void>;
    };
  };
} {
  const secrets = new Map<string, string>();
  const globalState = new Map<string, unknown>();

  return {
    context: {
      secrets: {
        get: (key) => Promise.resolve(secrets.get(key)),
        store: (key, value) => {
          secrets.set(key, value);
          return Promise.resolve();
        },
        delete: (key) => {
          secrets.delete(key);
          return Promise.resolve();
        },
      },
      globalState: {
        get: <T>(key: string) => globalState.get(key) as T | undefined,
        update: (key, value) => {
          if (typeof value === "undefined") globalState.delete(key);
          else globalState.set(key, value);
          return Promise.resolve();
        },
      },
    },
  };
}

function createOutput(): { warn: (msg: string) => void; info: (msg: string) => void } {
  return {
    warn: vi.fn(),
    info: vi.fn(),
  };
}

function createChatClientMock(): {
  client: Pick<ChatClient, "publishDmIdentity" | "openDm" | "sendDmMessage">;
  openDm: ReturnType<typeof vi.fn>;
  sendDmMessage: ReturnType<typeof vi.fn>;
} {
  const openDm = vi.fn();
  const sendDmMessage = vi.fn();
  const publishDmIdentity = vi.fn();

  return {
    client: { openDm, sendDmMessage, publishDmIdentity } as unknown as Pick<
      ChatClient,
      "publishDmIdentity" | "openDm" | "sendDmMessage"
    >,
    openDm,
    sendDmMessage,
  };
}

async function createEphemeralIdentity(options: { githubUserId: string }): Promise<{
  identity: DmIdentity;
  secretKeyBase64: string;
}> {
  const { context } = createMemoryContext();
  const keypair = await getOrCreateDmKeypair({
    githubUserId: options.githubUserId as import("@vscode-chat/protocol").GithubUserId,
    secrets: context.secrets,
  });
  return { identity: keypair.identity, secretKeyBase64: keypair.secretKeyBase64 };
}

function createTestUser(options: { githubUserId: string; login: string }): AuthUser {
  return AuthUserSchema.parse({
    githubUserId: options.githubUserId,
    login: options.login,
    avatarUrl: `https://example.test/${options.login}.png`,
    roles: [],
  });
}

function createTestUsers(): { alice: AuthUser; bob: AuthUser } {
  return {
    alice: createTestUser({ githubUserId: "1", login: "alice" }),
    bob: createTestUser({ githubUserId: "2", login: "bob" }),
  };
}

function createDirectMessagesHarness(): {
  mem: ReturnType<typeof createMemoryContext>;
  output: ReturnType<typeof createOutput>;
  dm: ChatViewDirectMessages;
} {
  const mem = createMemoryContext();
  const output = createOutput();
  const dm = new ChatViewDirectMessages(
    mem.context as unknown as import("vscode").ExtensionContext,
    output as unknown as import("vscode").LogOutputChannel,
  );
  return { mem, output, dm };
}

function createConnectedState(user: AuthUser): ChatClientState {
  return {
    authStatus: "signedIn",
    status: "connected",
    backendUrl: "http://example.test",
    user,
  } satisfies ChatClientState;
}

describe("ChatViewDirectMessages", () => {
  it("scopes DM secret keys per GitHub user id (v1 → v2 migration)", async () => {
    const mem = createMemoryContext();
    const v1SecretKeyBase64 = Buffer.from(nacl.box.keyPair().secretKey).toString("base64");
    await mem.context.secrets.store(DM_SECRET_STORAGE_KEY_V1, v1SecretKeyBase64);

    const user1 = "1" as import("@vscode-chat/protocol").GithubUserId;
    const user2 = "2" as import("@vscode-chat/protocol").GithubUserId;

    const keypair1 = await getOrCreateDmKeypair({
      githubUserId: user1,
      secrets: mem.context.secrets,
    });
    expect(keypair1.secretKeyBase64).toBe(v1SecretKeyBase64);
    expect(await mem.context.secrets.get(DM_SECRET_STORAGE_KEY_V1)).toBeUndefined();
    expect(await mem.context.secrets.get(dmSecretStorageKeyV2(user1))).toBe(v1SecretKeyBase64);

    const keypair2 = await getOrCreateDmKeypair({
      githubUserId: user2,
      secrets: mem.context.secrets,
    });
    expect(keypair2.secretKeyBase64).not.toBe(v1SecretKeyBase64);
    expect(await mem.context.secrets.get(dmSecretStorageKeyV2(user2))).toBe(
      keypair2.secretKeyBase64,
    );
  });

  it("migrates trusted peer keys to per-account storage (v1 → v2) without leaking across accounts", async () => {
    const { alice, bob } = createTestUsers();
    const { mem, dm } = createDirectMessagesHarness();
    const { client } = createChatClientMock();

    const connectedState = createConnectedState(alice);

    const bobKey = await createEphemeralIdentity({ githubUserId: bob.githubUserId });
    await mem.context.globalState.update("vscodeChat.dm.trustedPeerKeys.v1", {
      [bob.githubUserId]: [bobKey.identity.publicKey],
    });

    expect(dm.handleUiOpen(bob, client as unknown as ChatClient, connectedState)).toBeUndefined();

    const dmId = DmIdSchema.parse("dm:v1:1:2");
    const result = await dm.handleServerWelcome({
      event: {
        dmId,
        peerGithubUserId: bob.githubUserId,
        peerIdentity: bobKey.identity,
        history: [],
      },
      clientState: connectedState,
    });

    expect(result.error).toBeUndefined();
    expect(result.outbound[0]?.threads[0]?.isBlocked).toBe(false);

    expect(mem.context.globalState.get("vscodeChat.dm.trustedPeerKeys.v1")).toBeUndefined();
    expect(
      mem.context.globalState.get(`vscodeChat.dm.trustedPeerKeys.v2:${alice.githubUserId}`),
    ).toEqual({
      [bob.githubUserId]: [bobKey.identity.publicKey],
    });
  });

  it("blocks on peer key change until user explicitly trusts", async () => {
    const { alice, bob } = createTestUsers();
    const { mem, dm } = createDirectMessagesHarness();
    const { client, openDm, sendDmMessage } = createChatClientMock();

    const connectedState = createConnectedState(alice);

    const dmId = DmIdSchema.parse("dm:v1:1:2");

    const aliceKeypair = await getOrCreateDmKeypair({
      githubUserId: alice.githubUserId,
      secrets: mem.context.secrets,
    });
    const bobKey1 = await createEphemeralIdentity({ githubUserId: bob.githubUserId });
    const bobKey2 = await createEphemeralIdentity({ githubUserId: bob.githubUserId });

    const historyPlaintext = "hello from bob";
    const historyEncrypted = encryptDmText({
      plaintext: historyPlaintext,
      senderSecretKeyBase64: bobKey1.secretKeyBase64,
      senderIdentity: bobKey1.identity,
      recipientIdentity: aliceKeypair.identity,
    });
    const historyMessage: DmMessageCipher = {
      id: "m1",
      dmId,
      sender: bob,
      recipientGithubUserId: alice.githubUserId,
      senderIdentity: bobKey1.identity,
      recipientIdentity: aliceKeypair.identity,
      nonce: historyEncrypted.nonce,
      ciphertext: historyEncrypted.ciphertext,
      createdAt: new Date().toISOString(),
    };

    expect(dm.handleUiOpen(bob, client as unknown as ChatClient, connectedState)).toBeUndefined();
    expect(openDm).toHaveBeenCalledWith(bob.githubUserId);

    const welcome1 = await dm.handleServerWelcome({
      event: {
        dmId,
        peerGithubUserId: bob.githubUserId,
        peerIdentity: bobKey1.identity,
        history: [historyMessage],
      },
      clientState: connectedState,
    });
    expect(welcome1.error).toBeUndefined();
    expect(welcome1.history?.history[0]?.text).toBe(historyPlaintext);

    const keyChanged = await dm.handleServerWelcome({
      event: {
        dmId,
        peerGithubUserId: bob.githubUserId,
        peerIdentity: bobKey2.identity,
        history: [],
      },
      clientState: connectedState,
    });
    expect(keyChanged.outbound[0]?.threads[0]?.isBlocked).toBe(true);
    expect(keyChanged.outbound[0]?.threads[0]?.canTrustKey).toBe(true);

    const blockedSend = await dm.handleUiSend(
      dmId,
      "should not send",
      client as unknown as ChatClient,
      connectedState,
    );
    expect(blockedSend).toBe("Peer key changed. Trust the new key to continue.");
    expect(sendDmMessage).toHaveBeenCalledTimes(0);

    const stateAfterTrust = await dm.handleUiTrustPeerKey(dmId);
    expect(stateAfterTrust?.threads[0]?.isBlocked).toBe(false);
    expect(stateAfterTrust?.threads[0]?.canTrustKey).toBe(false);
    expect(stateAfterTrust?.threads[0]).not.toHaveProperty("warning");

    const postTrustText = "ok now";
    const ok = await dm.handleUiSend(
      dmId,
      postTrustText,
      client as unknown as ChatClient,
      connectedState,
    );
    expect(ok).toBeUndefined();
    expect(sendDmMessage).toHaveBeenCalledTimes(1);

    const sent = sendDmMessage.mock.calls[0]?.[0] as {
      senderIdentity: DmIdentity;
      recipientIdentity: DmIdentity;
      nonce: string;
      ciphertext: string;
    };
    expect(sent.recipientIdentity.publicKey).toBe(bobKey2.identity.publicKey);

    const decrypted = decryptDmText({
      message: sent,
      receiverSecretKeyBase64: bobKey2.secretKeyBase64,
      receiverPublicKeyBase64: bobKey2.identity.publicKey,
    });
    expect(decrypted.ok).toBe(true);
    if (decrypted.ok) {
      expect(decrypted.plaintext).toBe(postTrustText);
    }
  });
});
