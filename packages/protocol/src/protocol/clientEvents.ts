import { z } from "zod";
import { DmIdSchema, GithubUserIdSchema } from "../identifiers.js";
import { BaseEventSchema, CHAT_MESSAGE_TEXT_MAX_LEN, ClientMessageIdSchema } from "./common.js";
import { DmCiphertextSchema, DmIdentitySchema, DmNonceSchema } from "./dm.js";

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
  clientMessageId: ClientMessageIdSchema.optional(),
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
