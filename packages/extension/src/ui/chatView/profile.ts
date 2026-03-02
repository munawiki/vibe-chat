import { githubProfileErrorToMessage } from "../../net/githubProfile.js";
import type { GitHubProfileService } from "../../net/githubProfile/service.js";
import type { ExtProfileErrorMsg, ExtProfileResultMsg } from "../../contract/protocol/index.js";

export async function fetchProfileMessage(
  profiles: GitHubProfileService,
  login: string,
): Promise<ExtProfileResultMsg | ExtProfileErrorMsg> {
  const result = await profiles.getProfile(login);
  if (result.ok) return { type: "ext/profile.result", login, profile: result.profile };
  return { type: "ext/profile.error", login, message: githubProfileErrorToMessage(result.error) };
}
