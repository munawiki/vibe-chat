import { PROTOCOL_VERSION } from "@vscode-chat/protocol";
import type { ClientEvent, DmId, DmIdentity, GithubUserId } from "@vscode-chat/protocol";

export function buildMessageSendPayload(options: {
  text: string;
  clientMessageId?: string;
}): ClientEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "client/message.send",
    text: options.text,
    ...(options.clientMessageId ? { clientMessageId: options.clientMessageId } : {}),
  };
}

export function buildModerationDenyPayload(
  targetGithubUserId: GithubUserId,
  reason?: string,
): ClientEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "client/moderation.user.deny",
    targetGithubUserId,
    ...(typeof reason === "string" && reason.trim().length > 0 ? { reason } : {}),
  };
}

export function buildModerationAllowPayload(targetGithubUserId: GithubUserId): ClientEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "client/moderation.user.allow",
    targetGithubUserId,
  };
}

export function buildPublishDmIdentityPayload(identity: DmIdentity): ClientEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "client/dm.identity.publish",
    identity,
  };
}

export function buildOpenDmPayload(targetGithubUserId: GithubUserId): ClientEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "client/dm.open",
    targetGithubUserId,
  };
}

export function buildSendDmMessagePayload(options: {
  dmId: DmId;
  recipientGithubUserId: GithubUserId;
  senderIdentity: DmIdentity;
  recipientIdentity: DmIdentity;
  nonce: string;
  ciphertext: string;
}): ClientEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "client/dm.message.send",
    dmId: options.dmId,
    recipientGithubUserId: options.recipientGithubUserId,
    senderIdentity: options.senderIdentity,
    recipientIdentity: options.recipientIdentity,
    nonce: options.nonce,
    ciphertext: options.ciphertext,
  };
}
