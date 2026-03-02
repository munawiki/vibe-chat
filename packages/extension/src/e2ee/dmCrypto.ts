import nacl from "tweetnacl";
import type { DmIdentity, DmMessageCipher, GithubUserId } from "@vscode-chat/protocol";

export const DM_SECRET_STORAGE_KEY_V1 = "vscodeChat.dm.secretKey.v1";
const DM_SECRET_STORAGE_KEY_V2_PREFIX = "vscodeChat.dm.secretKey.v2:";

export function dmSecretStorageKeyV2(githubUserId: GithubUserId): string {
  return `${DM_SECRET_STORAGE_KEY_V2_PREFIX}${githubUserId}`;
}

export type DmKeypair = {
  identity: DmIdentity;
  secretKeyBase64: string;
};

export type DmSecretMigrationDiagnostic = {
  boundary: "dm.secret.migration";
  phase: "persist_v2" | "cleanup_v1";
  outcome: "ok" | "failed" | "skipped";
  errorClass?: "persist_v2_failed" | "cleanup_v1_failed";
};

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

type SecretStore = {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete?(key: string): Thenable<void>;
};

function keypairFromSecretKeyBase64(secretKeyBase64: string): DmKeypair {
  const secretKey = base64ToBytes(secretKeyBase64);
  const keyPair = nacl.box.keyPair.fromSecretKey(secretKey);
  return {
    identity: { cipherSuite: "nacl.box.v1", publicKey: bytesToBase64(keyPair.publicKey) },
    secretKeyBase64,
  };
}

async function persistV2AndCleanupV1(options: {
  secrets: SecretStore;
  v2Key: string;
  v1Secret: string;
  onDiagnostic?: (event: DmSecretMigrationDiagnostic) => void;
}): Promise<void> {
  try {
    await options.secrets.store(options.v2Key, options.v1Secret);
    options.onDiagnostic?.({
      boundary: "dm.secret.migration",
      phase: "persist_v2",
      outcome: "ok",
    });
  } catch (err) {
    options.onDiagnostic?.({
      boundary: "dm.secret.migration",
      phase: "persist_v2",
      outcome: "failed",
      errorClass: "persist_v2_failed",
    });
    throw err;
  }

  if (!options.secrets.delete) {
    options.onDiagnostic?.({
      boundary: "dm.secret.migration",
      phase: "cleanup_v1",
      outcome: "skipped",
    });
    return;
  }

  try {
    await options.secrets.delete(DM_SECRET_STORAGE_KEY_V1);
    options.onDiagnostic?.({
      boundary: "dm.secret.migration",
      phase: "cleanup_v1",
      outcome: "ok",
    });
  } catch {
    options.onDiagnostic?.({
      boundary: "dm.secret.migration",
      phase: "cleanup_v1",
      outcome: "failed",
      errorClass: "cleanup_v1_failed",
    });
  }
}

async function loadStoredOrMigratedSecret(options: {
  githubUserId: GithubUserId;
  secrets: SecretStore;
  onDiagnostic?: (event: DmSecretMigrationDiagnostic) => void;
}): Promise<string | undefined> {
  const v2Key = dmSecretStorageKeyV2(options.githubUserId);
  const existingV2 = await options.secrets.get(v2Key);
  if (existingV2) return existingV2;

  const v1 = await options.secrets.get(DM_SECRET_STORAGE_KEY_V1);
  if (!v1) return undefined;
  await persistV2AndCleanupV1({
    secrets: options.secrets,
    v2Key,
    v1Secret: v1,
    ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
  });
  return v1;
}

async function createAndStoreKeypair(options: {
  githubUserId: GithubUserId;
  secrets: SecretStore;
}): Promise<DmKeypair> {
  const keyPair = nacl.box.keyPair();
  const secretKeyBase64 = bytesToBase64(keyPair.secretKey);
  await options.secrets.store(dmSecretStorageKeyV2(options.githubUserId), secretKeyBase64);
  return {
    identity: { cipherSuite: "nacl.box.v1", publicKey: bytesToBase64(keyPair.publicKey) },
    secretKeyBase64,
  };
}

export async function getOrCreateDmKeypair(options: {
  githubUserId: GithubUserId;
  secrets: SecretStore;
  onDiagnostic?: (event: DmSecretMigrationDiagnostic) => void;
}): Promise<DmKeypair> {
  const stored = await loadStoredOrMigratedSecret(options);
  if (stored) return keypairFromSecretKeyBase64(stored);
  return createAndStoreKeypair(options);
}

export function encryptDmText(options: {
  plaintext: string;
  senderSecretKeyBase64: string;
  senderIdentity: DmIdentity;
  recipientIdentity: DmIdentity;
}): { nonce: string; ciphertext: string } {
  const senderSecretKey = base64ToBytes(options.senderSecretKeyBase64);
  const recipientPublicKey = base64ToBytes(options.recipientIdentity.publicKey);

  const sharedKey = nacl.box.before(recipientPublicKey, senderSecretKey);
  const nonceBytes = nacl.randomBytes(nacl.box.nonceLength);
  const plaintextBytes = Buffer.from(options.plaintext, "utf8");
  const ciphertextBytes = nacl.box.after(plaintextBytes, nonceBytes, sharedKey);

  return { nonce: bytesToBase64(nonceBytes), ciphertext: bytesToBase64(ciphertextBytes) };
}

export function decryptDmText(options: {
  message: Pick<DmMessageCipher, "senderIdentity" | "recipientIdentity" | "nonce" | "ciphertext">;
  receiverSecretKeyBase64: string;
  receiverPublicKeyBase64: string;
}):
  | { ok: true; peerIdentityPublicKey: string; plaintext: string }
  | { ok: false; error: "identity_mismatch" | "decrypt_failed" } {
  const myPublicKey = options.receiverPublicKeyBase64;
  const { senderIdentity, recipientIdentity } = options.message;

  let peerIdentityPublicKey: string | undefined;
  if (senderIdentity.publicKey === myPublicKey) {
    peerIdentityPublicKey = recipientIdentity.publicKey;
  } else if (recipientIdentity.publicKey === myPublicKey) {
    peerIdentityPublicKey = senderIdentity.publicKey;
  }
  if (!peerIdentityPublicKey) return { ok: false, error: "identity_mismatch" };

  const receiverSecretKey = base64ToBytes(options.receiverSecretKeyBase64);
  const peerPublicKey = base64ToBytes(peerIdentityPublicKey);
  const nonce = base64ToBytes(options.message.nonce);
  const ciphertext = base64ToBytes(options.message.ciphertext);

  const sharedKey = nacl.box.before(peerPublicKey, receiverSecretKey);
  const plaintextBytes = nacl.box.open.after(ciphertext, nonce, sharedKey);
  if (!plaintextBytes) return { ok: false, error: "decrypt_failed" };
  return {
    ok: true,
    peerIdentityPublicKey,
    plaintext: Buffer.from(plaintextBytes).toString("utf8"),
  };
}
