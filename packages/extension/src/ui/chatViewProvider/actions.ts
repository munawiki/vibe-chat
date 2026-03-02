import type { GithubUserId } from "@vscode-chat/protocol";
import type { ChatClient } from "../../net/chatClient.js";
import type { ExtOutbound } from "../../contract/protocol/index.js";
import { fetchProfileMessage } from "../chatView/profile.js";
import { openExternalHref } from "../chatView/external.js";
import type { ChatViewModeration } from "../chatView/moderation.js";
import type { ChatViewDirectMessages } from "../chatView/directMessages.js";
import type { GitHubProfileService } from "../../net/githubProfile/service.js";

export function sendPlaintextIfConnected(
  client: ChatClient,
  options: { text: string; clientMessageId: string },
): void {
  const state = client.getState();
  if (state.status !== "connected") return;
  client.sendMessage({ text: options.text, clientMessageId: options.clientMessageId });
}

export function runModerationAction(options: {
  moderation: ChatViewModeration;
  action: "deny" | "allow";
  targetGithubUserId: GithubUserId;
  client: ChatClient;
  postMessage: (message: ExtOutbound) => void;
}): void {
  const result = options.moderation.handleUiAction(
    options.action,
    options.targetGithubUserId,
    options.client.getState(),
  );
  options.postMessage(result.outbound);
  if (!result.send) return;
  if (result.send.action === "deny") {
    options.client.sendModerationDeny(result.send.targetGithubUserId);
  } else {
    options.client.sendModerationAllow(result.send.targetGithubUserId);
  }
}

export async function runOpenLink(options: {
  href: string;
  postError: (message: string) => void;
}): Promise<void> {
  const result = await openExternalHref(options.href);
  if (!result.ok) options.postError(result.message);
}

export async function runOpenProfile(options: {
  githubProfiles: GitHubProfileService;
  login: string;
  postMessage: (message: ExtOutbound) => void;
}): Promise<void> {
  const message = await fetchProfileMessage(options.githubProfiles, options.login);
  options.postMessage(message);
}

export function runDirectMessageOpen(options: {
  directMessages: ChatViewDirectMessages;
  peer: Parameters<ChatViewDirectMessages["handleUiOpen"]>[0];
  client: ChatClient;
  postError: (message: string) => void;
}): void {
  const err = options.directMessages.handleUiOpen(
    options.peer,
    options.client,
    options.client.getState(),
  );
  if (err) options.postError(err);
}

export function runDirectMessageThreadSelect(options: {
  directMessages: ChatViewDirectMessages;
  dmId: Parameters<ChatViewDirectMessages["handleUiThreadSelect"]>[0];
  client: ChatClient;
  postError: (message: string) => void;
}): void {
  const err = options.directMessages.handleUiThreadSelect(
    options.dmId,
    options.client,
    options.client.getState(),
  );
  if (err) options.postError(err);
}

export async function runDirectMessageSend(options: {
  directMessages: ChatViewDirectMessages;
  dmId: Parameters<ChatViewDirectMessages["handleUiSend"]>[0];
  text: Parameters<ChatViewDirectMessages["handleUiSend"]>[1];
  client: ChatClient;
  postError: (message: string) => void;
}): Promise<void> {
  const err = await options.directMessages.handleUiSend(
    options.dmId,
    options.text,
    options.client,
    options.client.getState(),
  );
  if (err) options.postError(err);
}

export async function runDirectMessageTrustPeerKey(options: {
  directMessages: ChatViewDirectMessages;
  dmId: Parameters<ChatViewDirectMessages["handleUiTrustPeerKey"]>[0];
  postMessage: (message: ExtOutbound) => void;
}): Promise<void> {
  const msg = await options.directMessages.handleUiTrustPeerKey(options.dmId);
  if (msg) options.postMessage(msg);
}

export function postDirectMessagesResult(options: {
  outbound: ExtOutbound[];
  additional: ExtOutbound | undefined;
  error: string | undefined;
  postMessage: (message: ExtOutbound) => void;
  postError: (message: string) => void;
}): void {
  for (const msg of options.outbound) options.postMessage(msg);
  if (options.additional) options.postMessage(options.additional);
  if (options.error) options.postError(options.error);
}
