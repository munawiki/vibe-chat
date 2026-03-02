import { z } from "zod";
import { DmIdSchema, GithubUserIdSchema } from "../identifiers.js";
import {
  AuthUserSchema,
  BaseEventSchema,
  ClientMessageIdSchema,
  ChatMessagePlainSchema,
} from "./common.js";
import { DmIdentitySchema, DmMessageCipherSchema } from "./dm.js";

export const ServerWelcomeSchema = BaseEventSchema.extend({
  type: z.literal("server/welcome"),
  user: AuthUserSchema,
  serverTime: z.string().datetime(),
  history: z.array(ChatMessagePlainSchema),
});

export const ServerMessageNewSchema = BaseEventSchema.extend({
  type: z.literal("server/message.new"),
  message: ChatMessagePlainSchema,
  clientMessageId: ClientMessageIdSchema.optional(),
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
  clientMessageId: ClientMessageIdSchema.optional(),
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
