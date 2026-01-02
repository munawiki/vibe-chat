import { z } from "zod";

/**
 * Invariant: This module is a "pure contract" that is safe to import from both
 * Extension Host (Node) and Webview (browser). Keep it dependency-light and
 * side-effect-free to prevent accidental runtime coupling.
 */

const NonEmptyString = z.string().min(1);

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
    githubUserId: NonEmptyString,
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

/**
 * Invariant: Public fields of `GitHubProfile` MUST remain stable across the
 * Extension Host and Webview boundary. Treat this module as the single source
 * of truth for that boundary contract.
 */
export type GitHubProfile = z.infer<typeof GitHubProfileSchema>;
