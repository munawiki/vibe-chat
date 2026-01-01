import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export const AuthUserSchema = z.object({
  githubUserId: z.string().min(1),
  login: z.string().min(1),
  avatarUrl: z.string().url(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  user: AuthUserSchema,
  text: z.string().min(1).max(500),
  createdAt: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

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
  text: z.string().min(1).max(500),
});

export const ClientEventSchema = z.discriminatedUnion("type", [
  ClientHelloSchema,
  ClientMessageSendSchema,
]);
export type ClientEvent = z.infer<typeof ClientEventSchema>;

export const ServerWelcomeSchema = BaseEventSchema.extend({
  type: z.literal("server/welcome"),
  user: AuthUserSchema,
  serverTime: z.string().datetime(),
  history: z.array(ChatMessageSchema),
});

export const ServerMessageNewSchema = BaseEventSchema.extend({
  type: z.literal("server/message.new"),
  message: ChatMessageSchema,
});

export const ServerErrorSchema = BaseEventSchema.extend({
  type: z.literal("server/error"),
  code: z.enum(["invalid_payload", "rate_limited", "auth_expired", "server_error"]),
  message: z.string().min(1).optional(),
  retryAfterMs: z.number().int().positive().optional(),
});

export const ServerEventSchema = z.discriminatedUnion("type", [
  ServerWelcomeSchema,
  ServerMessageNewSchema,
  ServerErrorSchema,
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
