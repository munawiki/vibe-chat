import { z } from "zod";
import {
  AuthUserSchema,
  CHAT_MESSAGE_TEXT_MAX_LEN,
  ChatMessagePlainSchema,
  ClientMessageIdSchema,
  ServerErrorSchema,
} from "@vscode-chat/protocol";

const NonEmptyString = z.string().min(1);

const ChatHeaderActionSchema = z.object({
  visible: z.boolean(),
  enabled: z.boolean(),
  label: NonEmptyString,
});

const ActionsSchema = z.object({
  signIn: ChatHeaderActionSchema,
  connect: ChatHeaderActionSchema,
});

const SignedOutStateBaseSchema = z.object({
  authStatus: z.literal("signedOut"),
  actions: ActionsSchema,
});

const SignedInStateBaseSchema = z.object({
  authStatus: z.literal("signedIn"),
  actions: ActionsSchema,
});

const SignedOutStateSchema = z.discriminatedUnion("status", [
  SignedOutStateBaseSchema.extend({
    status: z.literal("disconnected"),
    backendUrl: z.string().min(1).optional(),
  }),
  SignedOutStateBaseSchema.extend({
    status: z.literal("connecting"),
    backendUrl: z.string().min(1),
  }),
]);

const SignedInStateSchema = z.discriminatedUnion("status", [
  SignedInStateBaseSchema.extend({
    status: z.literal("disconnected"),
    backendUrl: z.string().min(1).optional(),
    user: AuthUserSchema.optional(),
  }),
  SignedInStateBaseSchema.extend({
    status: z.literal("connecting"),
    backendUrl: z.string().min(1),
    user: AuthUserSchema.optional(),
  }),
  SignedInStateBaseSchema.extend({
    status: z.literal("connected"),
    backendUrl: z.string().min(1),
    user: AuthUserSchema,
  }),
]);

export const ChatViewModelSchema = z.union([SignedOutStateSchema, SignedInStateSchema]);

const ExtStateSchema = z.object({ type: z.literal("ext/state"), state: ChatViewModelSchema });
const ExtHistorySchema = z.object({
  type: z.literal("ext/history"),
  history: z.array(ChatMessagePlainSchema),
});
const ExtMessageSchema = z.object({
  type: z.literal("ext/message"),
  message: ChatMessagePlainSchema,
  clientMessageId: ClientMessageIdSchema.optional(),
});
const ExtErrorSchema = z.object({ type: z.literal("ext/error"), message: NonEmptyString });
const ExtMessageSendErrorSchema = z.object({
  type: z.literal("ext/message.send.error"),
  clientMessageId: ClientMessageIdSchema,
  code: ServerErrorSchema.shape.code,
  message: NonEmptyString.optional(),
  retryAfterMs: ServerErrorSchema.shape.retryAfterMs,
});

const UiReadySchema = z.object({ type: z.literal("ui/ready") });
const UiSignInSchema = z.object({ type: z.literal("ui/signIn") });
const UiSignOutSchema = z.object({ type: z.literal("ui/signOut") });
const UiReconnectSchema = z.object({ type: z.literal("ui/reconnect") });
const UiSendSchema = z.object({
  type: z.literal("ui/send"),
  text: z.string().min(1).max(CHAT_MESSAGE_TEXT_MAX_LEN),
  clientMessageId: ClientMessageIdSchema,
});
const UiLinkOpenSchema = z.object({
  type: z.literal("ui/link.open"),
  href: z.string().min(1).max(2048),
});

export const chatExtOutboundSchemas = [
  ExtStateSchema,
  ExtHistorySchema,
  ExtMessageSchema,
  ExtErrorSchema,
  ExtMessageSendErrorSchema,
] as const;

export const chatUiInboundSchemas = [
  UiReadySchema,
  UiSignInSchema,
  UiSignOutSchema,
  UiReconnectSchema,
  UiSendSchema,
  UiLinkOpenSchema,
] as const;

export const ChatExtOutboundSchema = z.discriminatedUnion("type", chatExtOutboundSchemas);
export const ChatUiInboundSchema = z.discriminatedUnion("type", chatUiInboundSchemas);

export type ChatExtOutbound = z.infer<typeof ChatExtOutboundSchema>;
export type ChatUiInbound = z.infer<typeof ChatUiInboundSchema>;

export type ExtStateMsg = Extract<ChatExtOutbound, { type: "ext/state" }>;
export type ExtState = ExtStateMsg["state"];
export type ExtHistoryMsg = Extract<ChatExtOutbound, { type: "ext/history" }>;
export type ExtMessageMsg = Extract<ChatExtOutbound, { type: "ext/message" }>;
export type ExtMessageSendErrorMsg = Extract<ChatExtOutbound, { type: "ext/message.send.error" }>;
export type ExtErrorMsg = Extract<ChatExtOutbound, { type: "ext/error" }>;

export type UiReadyMsg = Extract<ChatUiInbound, { type: "ui/ready" }>;
export type UiSignInMsg = Extract<ChatUiInbound, { type: "ui/signIn" }>;
export type UiSignOutMsg = Extract<ChatUiInbound, { type: "ui/signOut" }>;
export type UiReconnectMsg = Extract<ChatUiInbound, { type: "ui/reconnect" }>;
export type UiSendMsg = Extract<ChatUiInbound, { type: "ui/send" }>;
export type UiLinkOpenMsg = Extract<ChatUiInbound, { type: "ui/link.open" }>;
