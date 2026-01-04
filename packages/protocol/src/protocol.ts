import { z } from "zod";
import { DmIdSchema, GithubUserIdSchema } from "./identifiers.js";

export const PROTOCOL_VERSION = 4 as const;

// Invariant: This is the single source of truth for the maximum chat message text length.
// UI, Extension Host, and Server validation MUST stay consistent with this value.
export const CHAT_MESSAGE_TEXT_MAX_LEN = 500 as const;

export const WsHandshakeRejectionCodeSchema = z.enum([
  "rate_limited",
  "room_full",
  "too_many_connections",
]);
export type WsHandshakeRejectionCode = z.infer<typeof WsHandshakeRejectionCodeSchema>;

export const WsHandshakeRejectionSchema = z.object({
  code: WsHandshakeRejectionCodeSchema,
  message: z.string().min(1).optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export type WsHandshakeRejection = z.infer<typeof WsHandshakeRejectionSchema>;

export const UserRoleSchema = z.enum(["moderator"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const AuthUserSchema = z.object({
  githubUserId: GithubUserIdSchema,
  login: z.string().min(1),
  avatarUrl: z.string().url(),
  roles: z.array(UserRoleSchema).default([]),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const ChatMessagePlainSchema = z.object({
  id: z.string().min(1),
  user: AuthUserSchema,
  text: z.string().min(1).max(CHAT_MESSAGE_TEXT_MAX_LEN),
  createdAt: z.string().datetime(),
});
export type ChatMessagePlain = z.infer<typeof ChatMessagePlainSchema>;

function base64DecodedBytesLength(value: string): number | null {
  if (value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  if (value.includes("=") && !/=+$/.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length * 3) / 4 - padding;
}

export const DmCipherSuiteSchema = z.enum(["nacl.box.v1"]);
export type DmCipherSuite = z.infer<typeof DmCipherSuiteSchema>;

export const DmIdentitySchema = z.object({
  cipherSuite: DmCipherSuiteSchema,
  publicKey: z
    .string()
    .min(1)
    .max(64)
    .refine((value) => base64DecodedBytesLength(value) === 32, {
      message: "Expected base64-encoded 32-byte public key",
    }),
});
export type DmIdentity = z.infer<typeof DmIdentitySchema>;

export const DmNonceSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => base64DecodedBytesLength(value) === 24, {
    message: "Expected base64-encoded 24-byte nonce",
  });
export type DmNonce = z.infer<typeof DmNonceSchema>;

export const DmCiphertextSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => base64DecodedBytesLength(value) !== null, {
    message: "Expected base64-encoded ciphertext",
  });
export type DmCiphertext = z.infer<typeof DmCiphertextSchema>;

export const DmMessageCipherSchema = z.object({
  id: z.string().min(1),
  dmId: DmIdSchema,
  sender: AuthUserSchema,
  recipientGithubUserId: GithubUserIdSchema,
  senderIdentity: DmIdentitySchema,
  recipientIdentity: DmIdentitySchema,
  nonce: DmNonceSchema,
  ciphertext: DmCiphertextSchema,
  createdAt: z.string().datetime(),
});
export type DmMessageCipher = z.infer<typeof DmMessageCipherSchema>;

export const DmMessagePlainSchema = ChatMessagePlainSchema.extend({
  dmId: DmIdSchema,
});
export type DmMessagePlain = z.infer<typeof DmMessagePlainSchema>;

export const SessionExchangeResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  user: AuthUserSchema,
});
export type SessionExchangeResponse = z.infer<typeof SessionExchangeResponseSchema>;

const BaseEventSchema = z.object({
  version: z.literal(PROTOCOL_VERSION),
  type: z.string().min(1),
});

export const ClientHelloSchema = BaseEventSchema.extend({
  type: z.literal("client/hello"),
  client: z.object({
    name: z.literal("vscode"),
    version: z.string().min(1).optional(),
  }),
});

export const ClientMessageSendSchema = BaseEventSchema.extend({
  type: z.literal("client/message.send"),
  text: z.string().min(1).max(CHAT_MESSAGE_TEXT_MAX_LEN),
});

export const ClientDmIdentityPublishSchema = BaseEventSchema.extend({
  type: z.literal("client/dm.identity.publish"),
  identity: DmIdentitySchema,
});

export const ClientDmOpenSchema = BaseEventSchema.extend({
  type: z.literal("client/dm.open"),
  targetGithubUserId: GithubUserIdSchema,
});

export const ClientDmMessageSendSchema = BaseEventSchema.extend({
  type: z.literal("client/dm.message.send"),
  dmId: DmIdSchema,
  recipientGithubUserId: GithubUserIdSchema,
  senderIdentity: DmIdentitySchema,
  recipientIdentity: DmIdentitySchema,
  nonce: DmNonceSchema,
  ciphertext: DmCiphertextSchema,
});

export const ClientModerationUserDenySchema = BaseEventSchema.extend({
  type: z.literal("client/moderation.user.deny"),
  targetGithubUserId: GithubUserIdSchema,
  reason: z.string().min(1).optional(),
});

export const ClientModerationUserAllowSchema = BaseEventSchema.extend({
  type: z.literal("client/moderation.user.allow"),
  targetGithubUserId: GithubUserIdSchema,
});

export const ClientEventSchema = z.discriminatedUnion("type", [
  ClientHelloSchema,
  ClientMessageSendSchema,
  ClientDmIdentityPublishSchema,
  ClientDmOpenSchema,
  ClientDmMessageSendSchema,
  ClientModerationUserDenySchema,
  ClientModerationUserAllowSchema,
]);
export type ClientEvent = z.infer<typeof ClientEventSchema>;

export const ServerWelcomeSchema = BaseEventSchema.extend({
  type: z.literal("server/welcome"),
  user: AuthUserSchema,
  serverTime: z.string().datetime(),
  history: z.array(ChatMessagePlainSchema),
});

export const ServerMessageNewSchema = BaseEventSchema.extend({
  type: z.literal("server/message.new"),
  message: ChatMessagePlainSchema,
});

export const ServerDmWelcomeSchema = BaseEventSchema.extend({
  type: z.literal("server/dm.welcome"),
  dmId: DmIdSchema,
  peerGithubUserId: GithubUserIdSchema,
  peerIdentity: DmIdentitySchema.optional(),
  history: z.array(DmMessageCipherSchema),
});

export const ServerDmMessageNewSchema = BaseEventSchema.extend({
  type: z.literal("server/dm.message.new"),
  message: DmMessageCipherSchema,
});

export const PresenceEntrySchema = z.object({
  user: AuthUserSchema,
  connections: z.number().int().min(1),
});
export type PresenceEntry = z.infer<typeof PresenceEntrySchema>;

export const PresenceSnapshotSchema = z.array(PresenceEntrySchema);
export type PresenceSnapshot = z.infer<typeof PresenceSnapshotSchema>;

export const ServerPresenceSchema = BaseEventSchema.extend({
  type: z.literal("server/presence"),
  snapshot: PresenceSnapshotSchema,
});

export const ServerModerationSnapshotSchema = BaseEventSchema.extend({
  type: z.literal("server/moderation.snapshot"),
  operatorDeniedGithubUserIds: z.array(GithubUserIdSchema),
  roomDeniedGithubUserIds: z.array(GithubUserIdSchema),
});

export const ServerModerationUserDeniedSchema = BaseEventSchema.extend({
  type: z.literal("server/moderation.user.denied"),
  actorGithubUserId: GithubUserIdSchema,
  targetGithubUserId: GithubUserIdSchema,
});

export const ServerModerationUserAllowedSchema = BaseEventSchema.extend({
  type: z.literal("server/moderation.user.allowed"),
  actorGithubUserId: GithubUserIdSchema,
  targetGithubUserId: GithubUserIdSchema,
});

export const ServerErrorSchema = BaseEventSchema.extend({
  type: z.literal("server/error"),
  code: z.enum(["invalid_payload", "forbidden", "rate_limited", "auth_expired", "server_error"]),
  message: z.string().min(1).optional(),
  retryAfterMs: z.number().int().positive().optional(),
});

export const ServerEventSchema = z.discriminatedUnion("type", [
  ServerWelcomeSchema,
  ServerMessageNewSchema,
  ServerDmWelcomeSchema,
  ServerDmMessageNewSchema,
  ServerPresenceSchema,
  ServerModerationSnapshotSchema,
  ServerModerationUserDeniedSchema,
  ServerModerationUserAllowedSchema,
  ServerErrorSchema,
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
