import * as vscode from "vscode";
import { normalizeExternalHref } from "../../contract/safeLinks.js";
import { unknownErrorToMessage } from "./errors.js";
import { GitHubLoginSchema } from "../../contract/githubProfile.js";

export async function openExternalHref(
  href: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const normalized = normalizeExternalHref(href);
  if (!normalized) {
    return { ok: false, message: "Unsupported link." };
  }

  try {
    await vscode.env.openExternal(vscode.Uri.parse(normalized));
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `openExternal failed: ${unknownErrorToMessage(err)}` };
  }
}

export async function openGitHubProfileInBrowser(login: string): Promise<void> {
  const parsed = GitHubLoginSchema.safeParse(login);
  if (!parsed.success) return;

  await vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${parsed.data}`));
}
