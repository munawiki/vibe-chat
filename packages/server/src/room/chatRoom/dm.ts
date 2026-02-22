import { z } from "zod";
import {
  DmIdentitySchema,
  DmMessageCipherSchema,
  GithubUserIdSchema,
  dmIdParticipants,
  type DmId,
  type DmIdentity,
  type DmMessageCipher,
  type GithubUserId,
} from "@vscode-chat/protocol";

const DM_IDENTITIES_KEY = "dm_identities";

const DmIdentitiesStorageSchema = z.record(z.string(), DmIdentitySchema);
const DmHistoryResponseSchema = z.object({ history: z.array(DmMessageCipherSchema) });

export class ChatRoomDmService {
  private readonly identities = new Map<GithubUserId, DmIdentity>();
  private identitiesReady: Promise<void> | undefined;

  constructor(
    private readonly state: DurableObjectState,
    private readonly dmRoom: DurableObjectNamespace,
  ) {}

  ensureIdentitiesLoaded(): Promise<void> {
    this.identitiesReady ??= this.loadIdentities();
    return this.identitiesReady;
  }

  getPeerGithubUserId(
    senderGithubUserId: GithubUserId,
    dmId: DmId,
  ):
    | { ok: true; peerGithubUserId: GithubUserId }
    | { ok: false; error: "invalid_dm_id" | "not_participant" } {
    let dmParticipants: { a: GithubUserId; b: GithubUserId };
    try {
      dmParticipants = dmIdParticipants(dmId);
    } catch {
      return { ok: false, error: "invalid_dm_id" };
    }

    if (senderGithubUserId === dmParticipants.a) {
      return { ok: true, peerGithubUserId: dmParticipants.b };
    }
    if (senderGithubUserId === dmParticipants.b) {
      return { ok: true, peerGithubUserId: dmParticipants.a };
    }
    return { ok: false, error: "not_participant" };
  }

  getIdentity(githubUserId: GithubUserId): DmIdentity | undefined {
    return this.identities.get(githubUserId);
  }

  async storeIdentity(githubUserId: GithubUserId, identity: DmIdentity): Promise<void> {
    this.identities.set(githubUserId, identity);
    await this.state.storage.put(DM_IDENTITIES_KEY, Object.fromEntries(this.identities));
  }

  async readHistory(dmId: DmId): Promise<DmMessageCipher[]> {
    const stub = this.dmRoom.get(this.dmRoom.idFromName(dmId));
    const response = await stub.fetch("https://dm-room/history");
    if (!response.ok) return [];

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return [];
    }

    const parsed = DmHistoryResponseSchema.safeParse(json);
    return parsed.success ? parsed.data.history : [];
  }

  async appendHistory(dmId: DmId, message: DmMessageCipher): Promise<void> {
    const stub = this.dmRoom.get(this.dmRoom.idFromName(dmId));
    await stub.fetch("https://dm-room/append", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(message),
    });
  }

  private async loadIdentities(): Promise<void> {
    const saved = await this.state.storage.get<unknown>(DM_IDENTITIES_KEY);
    const parsed = DmIdentitiesStorageSchema.safeParse(saved);
    if (!parsed.success) return;
    for (const [githubUserId, identity] of Object.entries(parsed.data)) {
      const githubUserIdParsed = GithubUserIdSchema.safeParse(githubUserId);
      if (!githubUserIdParsed.success) continue;
      this.identities.set(githubUserIdParsed.data, identity);
    }
  }
}
