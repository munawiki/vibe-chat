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
import { DmTrustedKeyStore } from "../src/ui/chatView/directMessagesTrustStore.js";
import { DmKeypairScope } from "../src/ui/chatView/directMessages/dmKeypairScope.js";
import { DmPeerRegistry } from "../src/ui/chatView/directMessages/dmPeerRegistry.js";
import { emitDmSecretMigrationDiagnostic } from "../src/ui/chatView/directMessagesDiagnostics.js";

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
  publishDmIdentity: ReturnType<typeof vi.fn>;
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
    publishDmIdentity,
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
  const trustedPeerKeys = new DmTrustedKeyStore(
    mem.context.globalState as unknown as import("vscode").Memento,
    output as unknown as import("vscode").LogOutputChannel,
  );
  const keypairScope = new DmKeypairScope({
    secrets: mem.context.secrets,
    trustedPeerKeys,
    onSecretMigrationDiagnostic: (event) =>
      emitDmSecretMigrationDiagnostic({
        output: output as unknown as import("vscode").LogOutputChannel,
        event,
      }),
  });
  const dm = new ChatViewDirectMessages({
    output: output as unknown as import("vscode").LogOutputChannel,
    trustedPeerKeys,
    keypairScope,
    peerRegistry: new DmPeerRegistry(),
  });
  return { mem, output, dm };
}

function createDirectMessagesFromContext(options: {
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
  output: ReturnType<typeof createOutput>;
}): ChatViewDirectMessages {
  const trustedPeerKeys = new DmTrustedKeyStore(
    options.context.globalState as unknown as import("vscode").Memento,
    options.output as unknown as import("vscode").LogOutputChannel,
  );
  const keypairScope = new DmKeypairScope({
    secrets: options.context.secrets,
    trustedPeerKeys,
    onSecretMigrationDiagnostic: (event) =>
      emitDmSecretMigrationDiagnostic({
        output: options.output as unknown as import("vscode").LogOutputChannel,
        event,
      }),
  });
  return new ChatViewDirectMessages({
    output: options.output as unknown as import("vscode").LogOutputChannel,
    trustedPeerKeys,
    keypairScope,
    peerRegistry: new DmPeerRegistry(),
  });
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
  it("validates UI actions for connection state and thread existence", async () => {
    const { alice, bob } = createTestUsers();
    const { dm } = createDirectMessagesHarness();
    const { client } = createChatClientMock();

    const disconnected: ChatClientState = { authStatus: "signedOut", status: "disconnected" };
    expect(dm.handleUiOpen(bob, client as unknown as ChatClient, disconnected)).toBe(
      "Not connected.",
    );

    const connectedState = createConnectedState(alice);
    expect(dm.handleUiOpen(alice, client as unknown as ChatClient, connectedState)).toBe(
      "Cannot DM self.",
    );

    const dmId = DmIdSchema.parse("dm:v1:1:2");
    expect(dm.handleUiThreadSelect(dmId, client as unknown as ChatClient, connectedState)).toBe(
      "Unknown DM thread.",
    );
    expect(await dm.handleUiSend(dmId, "hi", client as unknown as ChatClient, connectedState)).toBe(
      "Unknown DM thread.",
    );
  });

  it("returns deterministic error when server welcome arrives without known peer identity", async () => {
    const { alice, bob } = createTestUsers();
    const { dm } = createDirectMessagesHarness();
    const connectedState = createConnectedState(alice);

    const dmId = DmIdSchema.parse("dm:v1:1:2");
    const result = await dm.handleServerWelcome({
      event: {
        dmId,
        peerGithubUserId: bob.githubUserId,
        peerIdentity: undefined,
        history: [],
      },
      clientState: connectedState,
    });

    expect(result.error).toBe("Missing DM peer identity.");
    expect(result.outbound[0]?.type).toBe("ext/dm.state");
  });

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

  it("keeps legacy secret when cleanup fails and emits structured migration diagnostics", async () => {
    const v1SecretKeyBase64 = Buffer.from(nacl.box.keyPair().secretKey).toString("base64");
    const secrets = new Map<string, string>([[DM_SECRET_STORAGE_KEY_V1, v1SecretKeyBase64]]);
    const diagnostics: Array<{
      boundary: string;
      phase: string;
      outcome: string;
      errorClass?: string;
    }> = [];

    const keypair = await getOrCreateDmKeypair({
      githubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
      secrets: {
        get: (key: string) => Promise.resolve(secrets.get(key)),
        store: (key: string, value: string) => {
          secrets.set(key, value);
          return Promise.resolve();
        },
        delete: () => Promise.reject(new Error("cleanup_failed")),
      },
      onDiagnostic: (event) => diagnostics.push(event),
    });

    expect(keypair.secretKeyBase64).toBe(v1SecretKeyBase64);
    expect(
      secrets.get(dmSecretStorageKeyV2("1" as import("@vscode-chat/protocol").GithubUserId)),
    ).toBe(v1SecretKeyBase64);
    expect(secrets.get(DM_SECRET_STORAGE_KEY_V1)).toBe(v1SecretKeyBase64);
    expect(diagnostics).toEqual([
      {
        boundary: "dm.secret.migration",
        phase: "persist_v2",
        outcome: "ok",
      },
      {
        boundary: "dm.secret.migration",
        phase: "cleanup_v1",
        outcome: "failed",
        errorClass: "cleanup_v1_failed",
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain(v1SecretKeyBase64);
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
    const { mem, dm, output } = createDirectMessagesHarness();
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

    const infoCalls = (output.info as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.startsWith("dm trust transition: "));
    expect(infoCalls.some((line) => line.includes('"toState":"pending-trust"'))).toBe(true);
    expect(infoCalls.some((line) => line.includes('"toState":"trusted"'))).toBe(true);
  });

  it("unblocks on first trusted peer message and blocks on untrusted key changes", async () => {
    const { alice, bob } = createTestUsers();
    const { mem, dm } = createDirectMessagesHarness();
    const { client } = createChatClientMock();

    const connectedState = createConnectedState(alice);
    expect(dm.handleUiOpen(bob, client as unknown as ChatClient, connectedState)).toBeUndefined();

    const dmId = DmIdSchema.parse("dm:v1:1:2");
    const aliceKeypair = await getOrCreateDmKeypair({
      githubUserId: alice.githubUserId,
      secrets: mem.context.secrets,
    });

    const bobKey1 = await createEphemeralIdentity({ githubUserId: bob.githubUserId });
    const bobKey2 = await createEphemeralIdentity({ githubUserId: bob.githubUserId });

    await dm.handleServerWelcome({
      event: { dmId, peerGithubUserId: bob.githubUserId, peerIdentity: undefined, history: [] },
      clientState: connectedState,
    });

    const firstEncrypted = encryptDmText({
      plaintext: "hello",
      senderSecretKeyBase64: bobKey1.secretKeyBase64,
      senderIdentity: bobKey1.identity,
      recipientIdentity: aliceKeypair.identity,
    });
    const firstMessage: DmMessageCipher = {
      id: "m1",
      dmId,
      sender: bob,
      recipientGithubUserId: alice.githubUserId,
      senderIdentity: bobKey1.identity,
      recipientIdentity: aliceKeypair.identity,
      nonce: firstEncrypted.nonce,
      ciphertext: firstEncrypted.ciphertext,
      createdAt: new Date().toISOString(),
    };

    const first = await dm.handleServerMessageNew({
      event: { message: firstMessage },
      clientState: connectedState,
    });
    expect(first.error).toBeUndefined();
    expect(first.outbound[0]?.threads[0]?.isBlocked).toBe(false);

    const changedEncrypted = encryptDmText({
      plaintext: "new key",
      senderSecretKeyBase64: bobKey2.secretKeyBase64,
      senderIdentity: bobKey2.identity,
      recipientIdentity: aliceKeypair.identity,
    });
    const changedMessage: DmMessageCipher = {
      id: "m2",
      dmId,
      sender: bob,
      recipientGithubUserId: alice.githubUserId,
      senderIdentity: bobKey2.identity,
      recipientIdentity: aliceKeypair.identity,
      nonce: changedEncrypted.nonce,
      ciphertext: changedEncrypted.ciphertext,
      createdAt: new Date().toISOString(),
    };

    const changed = await dm.handleServerMessageNew({
      event: { message: changedMessage },
      clientState: connectedState,
    });
    expect(changed.outbound[0]?.threads[0]?.isBlocked).toBe(true);
    expect(changed.outbound[0]?.threads[0]?.canTrustKey).toBe(true);
  });

  it("clears in-memory thread/trust state immediately on account switch", async () => {
    const alice = createTestUser({ githubUserId: "1", login: "alice" });
    const bob = createTestUser({ githubUserId: "2", login: "bob" });
    const carol = createTestUser({ githubUserId: "3", login: "carol" });
    const dave = createTestUser({ githubUserId: "4", login: "dave" });

    const { dm } = createDirectMessagesHarness();
    const { client } = createChatClientMock();

    const aliceState = createConnectedState(alice);
    const carolState = createConnectedState(carol);

    const dmIdAliceBob = DmIdSchema.parse("dm:v1:1:2");
    const bobKey = await createEphemeralIdentity({ githubUserId: bob.githubUserId });

    expect(dm.handleUiOpen(bob, client as unknown as ChatClient, aliceState)).toBeUndefined();
    await dm.handleServerWelcome({
      event: {
        dmId: dmIdAliceBob,
        peerGithubUserId: bob.githubUserId,
        peerIdentity: bobKey.identity,
        history: [],
      },
      clientState: aliceState,
    });
    expect(dm.getStateMessage().threads.some((thread) => thread.dmId === dmIdAliceBob)).toBe(true);

    await dm.ensureIdentityPublished(client as unknown as ChatClient, carolState);
    expect(dm.getStateMessage().threads).toEqual([]);
    expect(
      await dm.handleUiSend(dmIdAliceBob, "hello", client as unknown as ChatClient, carolState),
    ).toBe("Unknown DM thread.");

    const dmIdCarolDave = DmIdSchema.parse("dm:v1:3:4");
    const daveKey = await createEphemeralIdentity({ githubUserId: dave.githubUserId });
    expect(dm.handleUiOpen(dave, client as unknown as ChatClient, carolState)).toBeUndefined();

    const nextWelcome = await dm.handleServerWelcome({
      event: {
        dmId: dmIdCarolDave,
        peerGithubUserId: dave.githubUserId,
        peerIdentity: daveKey.identity,
        history: [],
      },
      clientState: carolState,
    });
    expect(nextWelcome.error).toBeUndefined();
    expect(nextWelcome.outbound[0]?.threads.map((thread) => thread.dmId)).toEqual([dmIdCarolDave]);
  });

  it("does not publish stale identity when account scope changes during keypair load", async () => {
    const alice = createTestUser({ githubUserId: "1", login: "alice" });
    const carol = createTestUser({ githubUserId: "3", login: "carol" });

    let releaseAliceLookup: (() => void) | undefined;
    let aliceLookupBlocked = true;
    let notifyAliceLookupStarted: (() => void) | undefined;
    const aliceLookupStarted = new Promise<void>((resolve) => {
      notifyAliceLookupStarted = resolve;
    });
    const secrets = new Map<string, string>();
    const context = {
      secrets: {
        get: (key: string) => {
          if (key === dmSecretStorageKeyV2(alice.githubUserId) && aliceLookupBlocked) {
            aliceLookupBlocked = false;
            notifyAliceLookupStarted?.();
            return new Promise<string | undefined>((resolve) => {
              releaseAliceLookup = () => resolve(undefined);
            });
          }
          return Promise.resolve(secrets.get(key));
        },
        store: (key: string, value: string) => {
          secrets.set(key, value);
          return Promise.resolve();
        },
        delete: (key: string) => {
          secrets.delete(key);
          return Promise.resolve();
        },
      },
      globalState: {
        get: <T>(_: string) => undefined as T | undefined,
        update: (_: string, __: unknown) => Promise.resolve(),
      },
    };

    const output = createOutput();
    const dm = createDirectMessagesFromContext({ context, output });
    const { client, publishDmIdentity } = createChatClientMock();

    const aliceState = createConnectedState(alice);
    const carolState = createConnectedState(carol);

    const alicePublish = dm.ensureIdentityPublished(client as unknown as ChatClient, aliceState);
    await aliceLookupStarted;
    const carolPublish = dm.ensureIdentityPublished(client as unknown as ChatClient, carolState);
    releaseAliceLookup?.();

    await Promise.all([alicePublish, carolPublish]);

    expect(publishDmIdentity).toHaveBeenCalledTimes(1);
    const publishedIdentity = publishDmIdentity.mock.calls[0]?.[0] as { publicKey?: string };
    expect(typeof publishedIdentity?.publicKey).toBe("string");
    expect((publishedIdentity.publicKey ?? "").length).toBeGreaterThan(0);
  });

  it("reports decrypt failures without crashing", async () => {
    const { alice, bob } = createTestUsers();
    const { mem, output, dm } = createDirectMessagesHarness();
    const { client } = createChatClientMock();

    const connectedState = createConnectedState(alice);
    expect(dm.handleUiOpen(bob, client as unknown as ChatClient, connectedState)).toBeUndefined();

    const dmId = DmIdSchema.parse("dm:v1:1:2");
    const aliceKeypair = await getOrCreateDmKeypair({
      githubUserId: alice.githubUserId,
      secrets: mem.context.secrets,
    });
    const bobKey = await createEphemeralIdentity({ githubUserId: bob.githubUserId });

    const brokenMessage: DmMessageCipher = {
      id: "m1",
      dmId,
      sender: bob,
      recipientGithubUserId: alice.githubUserId,
      senderIdentity: bobKey.identity,
      recipientIdentity: aliceKeypair.identity,
      nonce: Buffer.alloc(24).toString("base64"),
      ciphertext: Buffer.alloc(32).toString("base64"),
      createdAt: new Date().toISOString(),
    };

    const result = await dm.handleServerMessageNew({
      event: { message: brokenMessage },
      clientState: connectedState,
    });
    expect(result.error).toBe("Failed to decrypt DM message.");
    expect((output.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      0,
    );
  });

  it("returns deterministic state-only outbound when not signed-in/connected", async () => {
    const { dm } = createDirectMessagesHarness();
    const dmId = DmIdSchema.parse("dm:v1:1:2");
    const disconnected: ChatClientState = { authStatus: "signedOut", status: "disconnected" };

    const welcome = await dm.handleServerWelcome({
      event: {
        dmId,
        peerGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
        history: [],
      },
      clientState: disconnected,
    });
    expect(welcome.outbound[0]?.type).toBe("ext/dm.state");
    expect(welcome.history).toBeUndefined();
    expect(welcome.error).toBeUndefined();

    const msg = await dm.handleServerMessageNew({
      event: {
        message: {
          id: "m1",
          dmId,
          sender: createTestUser({ githubUserId: "2", login: "bob" }),
          recipientGithubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
          senderIdentity: { cipherSuite: "nacl.box.v1", publicKey: "x" },
          recipientIdentity: { cipherSuite: "nacl.box.v1", publicKey: "y" },
          nonce: "zA==",
          ciphertext: "zA==",
          createdAt: new Date().toISOString(),
        },
      },
      clientState: disconnected,
    });
    expect(msg.outbound[0]?.type).toBe("ext/dm.state");
    expect(msg.message).toBeUndefined();
    expect(msg.error).toBeUndefined();
  });

  it("returns missing-peer error for self-sent DM events without cached peer mapping", async () => {
    const { alice } = createTestUsers();
    const { dm } = createDirectMessagesHarness();
    const connectedState = createConnectedState(alice);
    const dmId = DmIdSchema.parse("dm:v1:1:2");

    const result = await dm.handleServerMessageNew({
      event: {
        message: {
          id: "m-self",
          dmId,
          sender: alice,
          recipientGithubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
          senderIdentity: { cipherSuite: "nacl.box.v1", publicKey: "sender" },
          recipientIdentity: { cipherSuite: "nacl.box.v1", publicKey: "recipient" },
          nonce: "AA==",
          ciphertext: "AA==",
          createdAt: new Date().toISOString(),
        },
      },
      clientState: connectedState,
    });

    expect(result.error).toBe("Missing DM peer.");
    expect(result.message).toBeUndefined();
    expect(result.outbound[0]?.type).toBe("ext/dm.state");
  });

  it("emits failed migration diagnostics when DM secret v2 persistence fails", async () => {
    const { alice } = createTestUsers();
    const v1SecretKeyBase64 = Buffer.from(nacl.box.keyPair().secretKey).toString("base64");
    const legacyKey = DM_SECRET_STORAGE_KEY_V1;
    const scopedKey = dmSecretStorageKeyV2(alice.githubUserId);
    const secrets = new Map<string, string>([[legacyKey, v1SecretKeyBase64]]);
    const globalState = new Map<string, unknown>();
    const output = createOutput();

    const dm = createDirectMessagesFromContext({
      context: {
        secrets: {
          get: (key: string) => Promise.resolve(secrets.get(key)),
          store: (key: string, value: string) => {
            if (key === scopedKey) return Promise.reject(new Error("persist_failed"));
            secrets.set(key, value);
            return Promise.resolve();
          },
          delete: (key: string) => {
            secrets.delete(key);
            return Promise.resolve();
          },
        },
        globalState: {
          get: <T>(key: string) => globalState.get(key) as T | undefined,
          update: (key: string, value: unknown) => {
            if (typeof value === "undefined") globalState.delete(key);
            else globalState.set(key, value);
            return Promise.resolve();
          },
        },
      },
      output,
    });

    const { client } = createChatClientMock();
    await expect(
      dm.ensureIdentityPublished(client as unknown as ChatClient, createConnectedState(alice)),
    ).rejects.toBeInstanceOf(Error);

    const warnCalls = (output.warn as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.startsWith("dm secret migration: "));
    expect(warnCalls.some((line) => line.includes('"phase":"persist_v2"'))).toBe(true);
    expect(warnCalls.some((line) => line.includes('"errorClass":"persist_v2_failed"'))).toBe(true);
  });

  it("publishes identity only once and skips when auth state is not signed-in/connected", async () => {
    const { alice } = createTestUsers();
    const { dm } = createDirectMessagesHarness();
    const { client, publishDmIdentity } = createChatClientMock();

    await dm.ensureIdentityPublished(client as unknown as ChatClient, {
      authStatus: "signedOut",
      status: "disconnected",
    });
    expect(publishDmIdentity).toHaveBeenCalledTimes(0);

    const connectedState = createConnectedState(alice);
    await dm.ensureIdentityPublished(client as unknown as ChatClient, connectedState);
    await dm.ensureIdentityPublished(client as unknown as ChatClient, connectedState);
    expect(publishDmIdentity).toHaveBeenCalledTimes(1);
  });

  it("returns not-connected for thread-select/send when client is disconnected", async () => {
    const { dm } = createDirectMessagesHarness();
    const { client } = createChatClientMock();
    const disconnected: ChatClientState = { authStatus: "signedOut", status: "disconnected" };
    const dmId = DmIdSchema.parse("dm:v1:1:2");

    expect(dm.handleUiThreadSelect(dmId, client as unknown as ChatClient, disconnected)).toBe(
      "Not connected.",
    );
    await expect(
      dm.handleUiSend(dmId, "hi", client as unknown as ChatClient, disconnected),
    ).resolves.toBe("Not connected.");
  });

  it("returns undefined when trusting unknown threads or already-resolved trust states", async () => {
    const { alice, bob } = createTestUsers();
    const { dm } = createDirectMessagesHarness();
    const { client } = createChatClientMock();
    const connectedState = createConnectedState(alice);
    const dmId = DmIdSchema.parse("dm:v1:1:2");

    expect(await dm.handleUiTrustPeerKey(dmId)).toBeUndefined();

    const bobKey = await createEphemeralIdentity({ githubUserId: bob.githubUserId });
    expect(dm.handleUiOpen(bob, client as unknown as ChatClient, connectedState)).toBeUndefined();
    await dm.handleServerWelcome({
      event: {
        dmId,
        peerGithubUserId: bob.githubUserId,
        peerIdentity: bobKey.identity,
        history: [],
      },
      clientState: connectedState,
    });

    expect(await dm.handleUiTrustPeerKey(dmId)).toBeUndefined();
  });

  it("skips undecryptable welcome history messages and keeps deterministic state updates", async () => {
    const { alice, bob } = createTestUsers();
    const { mem, dm } = createDirectMessagesHarness();
    const { client } = createChatClientMock();
    const connectedState = createConnectedState(alice);
    const dmId = DmIdSchema.parse("dm:v1:1:2");

    const aliceKeypair = await getOrCreateDmKeypair({
      githubUserId: alice.githubUserId,
      secrets: mem.context.secrets,
    });
    const bobKey = await createEphemeralIdentity({ githubUserId: bob.githubUserId });
    const encrypted = encryptDmText({
      plaintext: "will fail decrypt",
      senderSecretKeyBase64: bobKey.secretKeyBase64,
      senderIdentity: bobKey.identity,
      recipientIdentity: aliceKeypair.identity,
    });

    expect(dm.handleUiOpen(bob, client as unknown as ChatClient, connectedState)).toBeUndefined();
    const result = await dm.handleServerWelcome({
      event: {
        dmId,
        peerGithubUserId: bob.githubUserId,
        peerIdentity: bobKey.identity,
        history: [
          {
            id: "broken",
            dmId,
            sender: bob,
            recipientGithubUserId: alice.githubUserId,
            senderIdentity: bobKey.identity,
            recipientIdentity: aliceKeypair.identity,
            nonce: encrypted.nonce,
            ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA`,
            createdAt: new Date().toISOString(),
          },
        ],
      },
      clientState: connectedState,
    });

    expect(result.error).toBeUndefined();
    expect(result.history?.history).toEqual([]);
    expect(result.outbound[0]?.type).toBe("ext/dm.state");
  });

  it("handles self-sent encrypted DM messages using recipient identity as peer key", async () => {
    const { alice, bob } = createTestUsers();
    const { mem, dm } = createDirectMessagesHarness();
    const { client } = createChatClientMock();
    const connectedState = createConnectedState(alice);
    const dmId = DmIdSchema.parse("dm:v1:1:2");

    const aliceKeypair = await getOrCreateDmKeypair({
      githubUserId: alice.githubUserId,
      secrets: mem.context.secrets,
    });
    const bobKey = await createEphemeralIdentity({ githubUserId: bob.githubUserId });
    expect(dm.handleUiOpen(bob, client as unknown as ChatClient, connectedState)).toBeUndefined();

    const encrypted = encryptDmText({
      plaintext: "self message",
      senderSecretKeyBase64: aliceKeypair.secretKeyBase64,
      senderIdentity: aliceKeypair.identity,
      recipientIdentity: bobKey.identity,
    });

    const result = await dm.handleServerMessageNew({
      event: {
        message: {
          id: "self-1",
          dmId,
          sender: alice,
          recipientGithubUserId: bob.githubUserId,
          senderIdentity: aliceKeypair.identity,
          recipientIdentity: bobKey.identity,
          nonce: encrypted.nonce,
          ciphertext: encrypted.ciphertext,
          createdAt: new Date().toISOString(),
        },
      },
      clientState: connectedState,
    });

    expect(result.error).toBeUndefined();
    expect(result.message?.message.text).toBe("self message");
    expect(result.outbound[0]?.threads[0]?.dmId).toBe(dmId);
  });

  it("emits info diagnostics for successful secret migration events", async () => {
    const { alice } = createTestUsers();
    const v1SecretKeyBase64 = Buffer.from(nacl.box.keyPair().secretKey).toString("base64");
    const secrets = new Map<string, string>([[DM_SECRET_STORAGE_KEY_V1, v1SecretKeyBase64]]);
    const globalState = new Map<string, unknown>();
    const output = createOutput();

    const dm = createDirectMessagesFromContext({
      context: {
        secrets: {
          get: (key: string) => Promise.resolve(secrets.get(key)),
          store: (key: string, value: string) => {
            secrets.set(key, value);
            return Promise.resolve();
          },
          delete: (key: string) => {
            secrets.delete(key);
            return Promise.resolve();
          },
        },
        globalState: {
          get: <T>(key: string) => globalState.get(key) as T | undefined,
          update: (key: string, value: unknown) => {
            if (typeof value === "undefined") globalState.delete(key);
            else globalState.set(key, value);
            return Promise.resolve();
          },
        },
      },
      output,
    });

    const { client } = createChatClientMock();
    await dm.ensureIdentityPublished(client as unknown as ChatClient, createConnectedState(alice));

    const infoCalls = (output.info as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.startsWith("dm secret migration: "));
    expect(infoCalls.some((line) => line.includes('"phase":"persist_v2"'))).toBe(true);
    expect(infoCalls.some((line) => line.includes('"phase":"cleanup_v1"'))).toBe(true);
  });
});
