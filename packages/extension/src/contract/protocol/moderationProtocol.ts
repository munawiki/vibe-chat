import { z } from "zod";
import { GithubUserIdSchema } from "@vscode-chat/protocol";

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
  message: z.string().min(1).optional(),
});

const UiModerationUserDenySchema = z.object({
  type: z.literal("ui/moderation.user.deny"),
  targetGithubUserId: GithubUserIdSchema,
});

const UiModerationUserAllowSchema = z.object({
  type: z.literal("ui/moderation.user.allow"),
  targetGithubUserId: GithubUserIdSchema,
});

export const moderationExtOutboundSchemas = [
  ExtModerationSnapshotSchema,
  ExtModerationUserDeniedSchema,
  ExtModerationUserAllowedSchema,
  ExtModerationActionSchema,
] as const;

export const moderationUiInboundSchemas = [
  UiModerationUserDenySchema,
  UiModerationUserAllowSchema,
] as const;

export const ModerationExtOutboundSchema = z.discriminatedUnion(
  "type",
  moderationExtOutboundSchemas,
);
export const ModerationUiInboundSchema = z.discriminatedUnion("type", moderationUiInboundSchemas);

export type ModerationExtOutbound = z.infer<typeof ModerationExtOutboundSchema>;
export type ModerationUiInbound = z.infer<typeof ModerationUiInboundSchema>;

export type ExtModerationSnapshotMsg = Extract<
  ModerationExtOutbound,
  { type: "ext/moderation.snapshot" }
>;
export type ExtModerationUserDeniedMsg = Extract<
  ModerationExtOutbound,
  { type: "ext/moderation.user.denied" }
>;
export type ExtModerationUserAllowedMsg = Extract<
  ModerationExtOutbound,
  { type: "ext/moderation.user.allowed" }
>;
export type ExtModerationActionMsg = Extract<
  ModerationExtOutbound,
  { type: "ext/moderation.action" }
>;

export type UiModerationUserDenyMsg = Extract<
  ModerationUiInbound,
  { type: "ui/moderation.user.deny" }
>;
export type UiModerationUserAllowMsg = Extract<
  ModerationUiInbound,
  { type: "ui/moderation.user.allow" }
>;
