import { z } from "zod";
import { GithubUserIdSchema } from "../identifiers.js";

export const PROTOCOL_VERSION = 4 as const;

export const CHAT_MESSAGE_TEXT_MAX_LEN = 500 as const;

export const ClientMessageIdSchema = z.string().uuid();
export type ClientMessageId = z.infer<typeof ClientMessageIdSchema>;

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

export const SessionExchangeResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  user: AuthUserSchema,
});
export type SessionExchangeResponse = z.infer<typeof SessionExchangeResponseSchema>;

export const BaseEventSchema = z.object({
  version: z.literal(PROTOCOL_VERSION),
  type: z.string().min(1),
});
