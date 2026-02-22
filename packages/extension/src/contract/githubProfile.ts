import { z } from "zod";
import { GithubUserIdSchema } from "@vscode-chat/protocol";

export const GitHubLoginSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d]))*$/i);

export const GitHubProfileMetaSchema = z.object({
  name: z.string().min(1).nullable().optional(),
  bio: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  blog: z.string().nullable().optional(),
});

export const GitHubProfileSchema = z
  .object({
    login: GitHubLoginSchema,
    githubUserId: GithubUserIdSchema,
    avatarUrl: z.string().url(),
    htmlUrl: z.string().url(),

    twitterUsername: z.string().nullable().optional(),

    publicRepos: z.number().int().nonnegative().optional(),
    followers: z.number().int().nonnegative().optional(),
    following: z.number().int().nonnegative().optional(),

    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .merge(GitHubProfileMetaSchema);
export type GitHubProfile = z.infer<typeof GitHubProfileSchema>;
