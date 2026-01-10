import { z } from "zod";
import {
  AuthUserSchema,
  CHAT_MESSAGE_TEXT_MAX_LEN,
  ChatMessagePlainSchema,
  ClientMessageIdSchema,
  DmIdSchema,
  DmMessagePlainSchema,
  GithubUserIdSchema,
  PresenceSnapshotSchema,
  ServerErrorSchema,
} from "@vscode-chat/protocol";
import { GitHubProfileSchema } from "./githubProfile.js";

export { GitHubProfileSchema };

const NonEmptyString = z.string().min(1);

export const UiInboundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ui/ready") }),
  z.object({ type: z.literal("ui/signIn") }),
  z.object({ type: z.literal("ui/signOut") }),
  z.object({ type: z.literal("ui/reconnect") }),
  z.object({
    type: z.literal("ui/send"),
    text: z.string().min(1).max(CHAT_MESSAGE_TEXT_MAX_LEN),
    clientMessageId: ClientMessageIdSchema,
  }),
  z.object({ type: z.literal("ui/dm.open"), peer: AuthUserSchema }),
  z.object({ type: z.literal("ui/dm.thread.select"), dmId: DmIdSchema }),
  z.object({
    type: z.literal("ui/dm.send"),
    dmId: DmIdSchema,
    text: z.string().min(1).max(CHAT_MESSAGE_TEXT_MAX_LEN),
  }),
  z.object({ type: z.literal("ui/dm.peerKey.trust"), dmId: DmIdSchema }),
  z.object({
    type: z.literal("ui/link.open"),
    href: z.string().min(1).max(2048),
  }),
  z.object({ type: z.literal("ui/profile.open"), login: NonEmptyString }),
  z.object({ type: z.literal("ui/profile.openOnGitHub"), login: NonEmptyString }),
  z.object({
    type: z.literal("ui/moderation.user.deny"),
    targetGithubUserId: GithubUserIdSchema,
  }),
  z.object({
    type: z.literal("ui/moderation.user.allow"),
    targetGithubUserId: GithubUserIdSchema,
  }),
]);

export type UiInbound = z.infer<typeof UiInboundSchema>;

const ChatHeaderActionSchema = z.object({
  visible: z.boolean(),
  enabled: z.boolean(),
  label: NonEmptyString,
});

const ActionsSchema = z.object({
  signIn: ChatHeaderActionSchema,
  connect: ChatHeaderActionSchema,
});

const SignedOutDisconnectedStateSchema = z.object({
  authStatus: z.literal("signedOut"),
  status: z.literal("disconnected"),
  backendUrl: z.string().min(1).optional(),
});

const SignedOutConnectingStateSchema = z.object({
  authStatus: z.literal("signedOut"),
  status: z.literal("connecting"),
  backendUrl: z.string().min(1),
});

const SignedInDisconnectedStateSchema = z.object({
  authStatus: z.literal("signedIn"),
  status: z.literal("disconnected"),
  backendUrl: z.string().min(1).optional(),
  user: AuthUserSchema.optional(),
});

const SignedInConnectingStateSchema = z.object({
  authStatus: z.literal("signedIn"),
  status: z.literal("connecting"),
  backendUrl: z.string().min(1),
  user: AuthUserSchema.optional(),
});

const SignedInConnectedStateSchema = z.object({
  authStatus: z.literal("signedIn"),
  status: z.literal("connected"),
  backendUrl: z.string().min(1),
  user: AuthUserSchema,
});

export const ChatViewModelSchema = z.union([
  SignedOutDisconnectedStateSchema.extend({ actions: ActionsSchema }),
  SignedOutConnectingStateSchema.extend({ actions: ActionsSchema }),
  SignedInDisconnectedStateSchema.extend({ actions: ActionsSchema }),
  SignedInConnectingStateSchema.extend({ actions: ActionsSchema }),
  SignedInConnectedStateSchema.extend({ actions: ActionsSchema }),
]);

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

const DmThreadSchema = z.object({
  dmId: DmIdSchema,
  peer: AuthUserSchema,
  isBlocked: z.boolean(),
  canTrustKey: z.boolean(),
  warning: NonEmptyString.optional(),
});

const ExtDmStateSchema = z.object({
  type: z.literal("ext/dm.state"),
  threads: z.array(DmThreadSchema),
});

const ExtDmHistorySchema = z.object({
  type: z.literal("ext/dm.history"),
  dmId: DmIdSchema,
  history: z.array(DmMessagePlainSchema),
});

const ExtDmMessageSchema = z.object({
  type: z.literal("ext/dm.message"),
  message: DmMessagePlainSchema,
});
const ExtPresenceSchema = z.object({
  type: z.literal("ext/presence"),
  snapshot: PresenceSnapshotSchema,
});
const ExtErrorSchema = z.object({ type: z.literal("ext/error"), message: NonEmptyString });
const ExtMessageSendErrorSchema = z.object({
  type: z.literal("ext/message.send.error"),
  clientMessageId: ClientMessageIdSchema,
  code: ServerErrorSchema.shape.code,
  message: NonEmptyString.optional(),
  retryAfterMs: ServerErrorSchema.shape.retryAfterMs,
});
const ExtProfileResultSchema = z.object({
  type: z.literal("ext/profile.result"),
  login: NonEmptyString,
  profile: GitHubProfileSchema,
});
const ExtProfileErrorSchema = z.object({
  type: z.literal("ext/profile.error"),
  login: NonEmptyString,
  message: NonEmptyString,
});

const ExtModerationSnapshotSchema = z.object({
  type: z.literal("ext/moderation.snapshot"),
  operatorDeniedGithubUserIds: z.array(GithubUserIdSchema),
  roomDeniedGithubUserIds: z.array(GithubUserIdSchema),
});

const ExtModerationUserDeniedSchema = z.object({
  type: z.literal("ext/moderation.user.denied"),
  actorGithubUserId: GithubUserIdSchema,
  targetGithubUserId: GithubUserIdSchema,
});

const ExtModerationUserAllowedSchema = z.object({
  type: z.literal("ext/moderation.user.allowed"),
  actorGithubUserId: GithubUserIdSchema,
  targetGithubUserId: GithubUserIdSchema,
});

const ExtModerationActionSchema = z.object({
  type: z.literal("ext/moderation.action"),
  action: z.enum(["deny", "allow"]),
  targetGithubUserId: GithubUserIdSchema,
  phase: z.enum(["pending", "success", "error"]),
  message: NonEmptyString.optional(),
});

export const ExtOutboundSchema = z.discriminatedUnion("type", [
  ExtStateSchema,
  ExtHistorySchema,
  ExtMessageSchema,
  ExtDmStateSchema,
  ExtDmHistorySchema,
  ExtDmMessageSchema,
  ExtPresenceSchema,
  ExtMessageSendErrorSchema,
  ExtErrorSchema,
  ExtProfileResultSchema,
  ExtProfileErrorSchema,
  ExtModerationSnapshotSchema,
  ExtModerationUserDeniedSchema,
  ExtModerationUserAllowedSchema,
  ExtModerationActionSchema,
]);

export type ExtOutbound = z.infer<typeof ExtOutboundSchema>;

export type ExtStateMsg = Extract<ExtOutbound, { type: "ext/state" }>;
export type ExtState = ExtStateMsg["state"];
export type ExtHistoryMsg = Extract<ExtOutbound, { type: "ext/history" }>;
export type ExtMessageMsg = Extract<ExtOutbound, { type: "ext/message" }>;
export type ExtMessageSendErrorMsg = Extract<ExtOutbound, { type: "ext/message.send.error" }>;
export type ExtDmStateMsg = Extract<ExtOutbound, { type: "ext/dm.state" }>;
export type ExtDmHistoryMsg = Extract<ExtOutbound, { type: "ext/dm.history" }>;
export type ExtDmMessageMsg = Extract<ExtOutbound, { type: "ext/dm.message" }>;
export type ExtPresenceMsg = Extract<ExtOutbound, { type: "ext/presence" }>;
export type ExtErrorMsg = Extract<ExtOutbound, { type: "ext/error" }>;

export type ExtProfileResultMsg = Extract<ExtOutbound, { type: "ext/profile.result" }>;
export type ExtProfileErrorMsg = Extract<ExtOutbound, { type: "ext/profile.error" }>;

export type ExtModerationSnapshotMsg = Extract<ExtOutbound, { type: "ext/moderation.snapshot" }>;
export type ExtModerationUserDeniedMsg = Extract<
  ExtOutbound,
  { type: "ext/moderation.user.denied" }
>;
export type ExtModerationUserAllowedMsg = Extract<
  ExtOutbound,
  { type: "ext/moderation.user.allowed" }
>;
export type ExtModerationActionMsg = Extract<ExtOutbound, { type: "ext/moderation.action" }>;
