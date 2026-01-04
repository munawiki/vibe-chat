import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { AuthUserSchema, DmIdSchema } from "@vscode-chat/protocol";
import type { DmIdentity, DmMessageCipher } from "@vscode-chat/protocol";
import type { ChatClient } from "../src/net/chatClient.js";
import type { ChatClientState } from "../src/net/chatClient.js";
import { decryptDmText, encryptDmText, getOrCreateDmKeypair } from "../src/e2ee/dmCrypto.js";
import { ChatViewDirectMessages } from "../src/ui/chatView/directMessages.js";

function createMemoryContext(): {
  context: {
    secrets: {
      get(key: string): Thenable<string | undefined>;
      store(key: string, value: string): Thenable<void>;
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
      },
      globalState: {
        get: <T>(key: string) => globalState.get(key) as T | undefined,
        update: (key, value) => {
          globalState.set(key, value);
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

async function createEphemeralIdentity(): Promise<{
  identity: DmIdentity;
  secretKeyBase64: string;
}> {
  const { context } = createMemoryContext();
  const keypair = await getOrCreateDmKeypair({
    secrets: context.secrets,
  });
  return { identity: keypair.identity, secretKeyBase64: keypair.secretKeyBase64 };
}

describe("ChatViewDirectMessages", () => {
  it("blocks on peer key change until user explicitly trusts", async () => {
    const alice = AuthUserSchema.parse({
      githubUserId: "1",
      login: "alice",
      avatarUrl: "https://example.test/a.png",
      roles: [],
    });
    const bob = AuthUserSchema.parse({
      githubUserId: "2",
      login: "bob",
      avatarUrl: "https://example.test/b.png",
      roles: [],
    });

    const mem = createMemoryContext();
    const output = createOutput();
    const dm = new ChatViewDirectMessages(
      mem.context as unknown as import("vscode").ExtensionContext,
      output as unknown as import("vscode").LogOutputChannel,
    );
    const { client, openDm, sendDmMessage } = createChatClientMock();

    const connectedState = {
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user: alice,
    } satisfies ChatClientState;

    const dmId = DmIdSchema.parse("dm:v1:1:2");

    const aliceKeypair = await getOrCreateDmKeypair({ secrets: mem.context.secrets });
    const bobKey1 = await createEphemeralIdentity();
    const bobKey2 = await createEphemeralIdentity();

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
