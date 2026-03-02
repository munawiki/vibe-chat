import { z } from "zod";
import { GitHubProfileSchema } from "../githubProfile.js";

const NonEmptyString = z.string().min(1);

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

const UiProfileOpenSchema = z.object({ type: z.literal("ui/profile.open"), login: NonEmptyString });
const UiProfileOpenOnGitHubSchema = z.object({
  type: z.literal("ui/profile.openOnGitHub"),
  login: NonEmptyString,
});

export const profileExtOutboundSchemas = [ExtProfileResultSchema, ExtProfileErrorSchema] as const;
export const profileUiInboundSchemas = [UiProfileOpenSchema, UiProfileOpenOnGitHubSchema] as const;

export const ProfileExtOutboundSchema = z.discriminatedUnion("type", profileExtOutboundSchemas);
export const ProfileUiInboundSchema = z.discriminatedUnion("type", profileUiInboundSchemas);

export type ProfileExtOutbound = z.infer<typeof ProfileExtOutboundSchema>;
export type ProfileUiInbound = z.infer<typeof ProfileUiInboundSchema>;

export type ExtProfileResultMsg = Extract<ProfileExtOutbound, { type: "ext/profile.result" }>;
export type ExtProfileErrorMsg = Extract<ProfileExtOutbound, { type: "ext/profile.error" }>;

export type UiProfileOpenMsg = Extract<ProfileUiInbound, { type: "ui/profile.open" }>;
export type UiProfileOpenOnGitHubMsg = Extract<
  ProfileUiInbound,
  { type: "ui/profile.openOnGitHub" }
>;
