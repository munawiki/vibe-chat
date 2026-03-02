import type { GitHubProfileError } from "./githubProfile/fetch.js";

export {
  GitHubLoginSchema,
  GitHubProfileMetaSchema,
  GitHubProfileSchema,
} from "../contract/githubProfile.js";
export type { GitHubProfile } from "../contract/githubProfile.js";
export {
  GitHubProfileService,
  type GitHubProfileServiceOptions,
} from "./githubProfile/service.js";
export type { GitHubProfileError, GitHubProfileResult } from "./githubProfile/fetch.js";

export function githubProfileErrorToMessage(error: GitHubProfileError): string {
  switch (error.type) {
    case "invalid_login":
      return "github_profile_invalid_login";
    case "fetch_failed":
      return `github_profile_fetch_failed_${error.status}`;
    case "invalid_json":
      return "github_profile_invalid_json";
    case "schema_mismatch":
      return "github_profile_schema_mismatch";
    case "network_error": {
      const msg = error.cause instanceof Error ? error.cause.message : String(error.cause);
      const trimmed = msg.trim();
      return trimmed.length > 0 ? trimmed : "github_profile_network_error";
    }
  }
}
