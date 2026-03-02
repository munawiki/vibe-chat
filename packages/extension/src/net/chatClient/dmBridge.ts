import { ClientEventSchema } from "@vscode-chat/protocol";
import type { ClientEvent, DmId, DmIdentity, GithubUserId } from "@vscode-chat/protocol";
import {
  buildOpenDmPayload,
  buildPublishDmIdentityPayload,
  buildSendDmMessagePayload,
} from "./payloads.js";
import type { DmBridgeDeps } from "./types.js";

export class DmBridge {
  constructor(private readonly deps: DmBridgeDeps) {}

  publishIdentity(identity: DmIdentity): void {
    this.sendClientEvent(buildPublishDmIdentityPayload(identity));
  }

  openDm(targetGithubUserId: GithubUserId): void {
    this.sendClientEvent(buildOpenDmPayload(targetGithubUserId));
  }

  sendDmMessage(options: {
    dmId: DmId;
    recipientGithubUserId: GithubUserId;
    senderIdentity: DmIdentity;
    recipientIdentity: DmIdentity;
    nonce: string;
    ciphertext: string;
  }): void {
    this.sendClientEvent(buildSendDmMessagePayload(options));
  }

  private sendClientEvent(payload: ClientEvent): void {
    const parsed = ClientEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.deps.output.warn("Rejected client payload by schema.");
      return;
    }

    const result = this.deps.ws.sendClientEvent(payload);
    if (result.ok) return;

    if (result.reason === "not_open") {
      this.deps.output.warn("WebSocket not open.");
      return;
    }

    this.deps.output.warn(`WebSocket send failed: ${String(result.error)}`);
  }
}
