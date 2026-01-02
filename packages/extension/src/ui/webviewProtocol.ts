import { z } from "zod";
import { AuthUserSchema, ChatMessageSchema, PresenceSnapshotSchema } from "@vscode-chat/protocol";
import { GitHubProfileSchema } from "../contract/githubProfile.js";
import type { ChatViewModel } from "./viewModel.js";

export { GitHubProfileSchema };

const NonEmptyString = z.string().min(1);

export const UiInboundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ui/ready") }),
  z.object({ type: z.literal("ui/signIn") }),
  z.object({ type: z.literal("ui/reconnect") }),
  z.object({ type: z.literal("ui/send"), text: NonEmptyString }),
  z.object({ type: z.literal("ui/profile.open"), login: NonEmptyString }),
  z.object({ type: z.literal("ui/profile.openOnGitHub"), login: NonEmptyString }),
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

type _SchemaMatchesChatViewModel =
  ChatViewModel extends z.infer<typeof ChatViewModelSchema> ? true : never;

const ExtStateSchema = z.object({ type: z.literal("ext/state"), state: ChatViewModelSchema });
const ExtHistorySchema = z.object({
  type: z.literal("ext/history"),
  history: z.array(ChatMessageSchema),
});
const ExtMessageSchema = z.object({ type: z.literal("ext/message"), message: ChatMessageSchema });
const ExtPresenceSchema = z.object({
  type: z.literal("ext/presence"),
  snapshot: PresenceSnapshotSchema,
});
const ExtErrorSchema = z.object({ type: z.literal("ext/error"), message: NonEmptyString });
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

export const ExtOutboundSchema = z.discriminatedUnion("type", [
  ExtStateSchema,
  ExtHistorySchema,
  ExtMessageSchema,
  ExtPresenceSchema,
  ExtErrorSchema,
  ExtProfileResultSchema,
  ExtProfileErrorSchema,
]);

export type ExtOutbound = z.infer<typeof ExtOutboundSchema>;
