import type * as vscode from "vscode";
import { z } from "zod";
import type { GithubUserId } from "@vscode-chat/protocol";
import { GithubUserIdSchema } from "@vscode-chat/protocol";

const TRUSTED_PEER_KEYS_STORAGE_KEY_V1 = "vscodeChat.dm.trustedPeerKeys.v1";
const TRUSTED_PEER_KEYS_STORAGE_KEY_V2_PREFIX = "vscodeChat.dm.trustedPeerKeys.v2:";
const TRUSTED_KEYS_MIGRATION_DIAG = "dm trusted keys migration";

export function trustedPeerKeysStorageKeyV2(githubUserId: GithubUserId): string {
  return `${TRUSTED_PEER_KEYS_STORAGE_KEY_V2_PREFIX}${githubUserId}`;
}

const TrustedPeerKeysSchema = z.record(z.string(), z.array(z.string().min(1)));
type TrustedPeerKeys = z.infer<typeof TrustedPeerKeysSchema>;

export class DmTrustedKeyStore {
  private loadedForGithubUserId: GithubUserId | null = null;
  private readonly trustedPeerKeysByGithubUserId = new Map<GithubUserId, Set<string>>();

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly output: vscode.LogOutputChannel,
  ) {}

  reset(): void {
    this.loadedForGithubUserId = null;
    this.trustedPeerKeysByGithubUserId.clear();
  }

  async ensureScope(githubUserId: GithubUserId): Promise<void> {
    if (this.loadedForGithubUserId === githubUserId) return;

    this.trustedPeerKeysByGithubUserId.clear();

    const v2Key = trustedPeerKeysStorageKeyV2(githubUserId);
    const raw = await this.loadScopedTrustedPeerKeys(v2Key);

    const parsed = TrustedPeerKeysSchema.safeParse(raw);
    if (parsed.success) {
      for (const [githubUserIdRaw, keys] of Object.entries(parsed.data)) {
        const githubUserIdParsed = GithubUserIdSchema.safeParse(githubUserIdRaw);
        if (!githubUserIdParsed.success) continue;
        this.trustedPeerKeysByGithubUserId.set(githubUserIdParsed.data, new Set(keys));
      }
    }

    this.loadedForGithubUserId = githubUserId;
  }

  private async loadScopedTrustedPeerKeys(v2Key: string): Promise<unknown> {
    const scopedRaw = this.globalState.get<unknown>(v2Key);
    if (scopedRaw !== undefined) return scopedRaw;

    const v1Raw = this.globalState.get<unknown>(TRUSTED_PEER_KEYS_STORAGE_KEY_V1);
    const parsed = TrustedPeerKeysSchema.safeParse(v1Raw);
    if (!parsed.success) return scopedRaw;

    await this.migrateTrustedPeerKeysV1ToV2(v2Key, parsed.data);
    return parsed.data;
  }

  private async migrateTrustedPeerKeysV1ToV2(v2Key: string, data: TrustedPeerKeys): Promise<void> {
    try {
      await this.globalState.update(v2Key, data);
    } catch {
      this.emitMigrationDiagnostic({
        phase: "persist_v2",
        outcome: "failed",
        errorClass: "persist_v2_failed",
      });
      return;
    }

    this.emitMigrationDiagnostic({ phase: "persist_v2", outcome: "ok" });

    try {
      // Cleanup is best-effort and only runs after the destination write succeeds.
      await this.globalState.update(TRUSTED_PEER_KEYS_STORAGE_KEY_V1, undefined);
      this.emitMigrationDiagnostic({ phase: "cleanup_v1", outcome: "ok" });
    } catch {
      this.emitMigrationDiagnostic({
        phase: "cleanup_v1",
        outcome: "failed",
        errorClass: "cleanup_v1_failed",
      });
    }
  }

  private emitMigrationDiagnostic(options: {
    phase: "persist_v2" | "cleanup_v1";
    outcome: "ok" | "failed";
    errorClass?: "persist_v2_failed" | "cleanup_v1_failed";
  }): void {
    const payload = JSON.stringify({
      boundary: "dm.trust.migration",
      phase: options.phase,
      outcome: options.outcome,
      ...(options.errorClass ? { errorClass: options.errorClass } : {}),
    });
    const line = `${TRUSTED_KEYS_MIGRATION_DIAG}: ${payload}`;
    if (options.outcome === "failed") this.output.warn(line);
    else this.output.info(line);
  }

  async observePeerKey(
    peerGithubUserId: GithubUserId,
    publicKey: string,
  ): Promise<{ trusted: boolean }> {
    const set = this.trustedPeerKeysByGithubUserId.get(peerGithubUserId);
    if (!set || set.size === 0) {
      await this.addTrustedPeerKey(peerGithubUserId, publicKey);
      return { trusted: true };
    }
    return { trusted: set.has(publicKey) };
  }

  async addTrustedPeerKey(peerGithubUserId: GithubUserId, publicKey: string): Promise<void> {
    const set = this.trustedPeerKeysByGithubUserId.get(peerGithubUserId) ?? new Set<string>();
    set.add(publicKey);
    this.trustedPeerKeysByGithubUserId.set(peerGithubUserId, set);
    await this.persistScopedTrustedPeerKeys();
  }

  private async persistScopedTrustedPeerKeys(): Promise<void> {
    const githubUserId = this.loadedForGithubUserId;
    if (!githubUserId) return;

    const out: Record<string, string[]> = {};
    for (const [peerGithubUserId, keys] of this.trustedPeerKeysByGithubUserId) {
      out[peerGithubUserId] = [...keys];
    }
    await this.globalState.update(trustedPeerKeysStorageKeyV2(githubUserId), out);
  }
}
