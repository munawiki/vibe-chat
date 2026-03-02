import { openGitHubProfileInBrowser } from "../chatView/external.js";
import {
  postDirectMessagesResult,
  runDirectMessageOpen,
  runDirectMessageSend,
  runDirectMessageThreadSelect,
  runDirectMessageTrustPeerKey,
  runModerationAction,
  runOpenLink,
  runOpenProfile,
  sendPlaintextIfConnected,
} from "./actions.js";
import { createServerEventRouter } from "./serverEventRouter.js";
import { createUiMessageRouter } from "./uiRouter.js";
import type { ServerEvent } from "@vscode-chat/protocol";
import type { ProviderContext } from "./types.js";

export function createProviderRouters(context: ProviderContext): {
  routeUiMessage: (msg: unknown) => Promise<void>;
  routeServerEvent: (event: ServerEvent) => Promise<void>;
} {
  const routeUiMessage = createUiMessageRouter({
    output: context.output,
    handlers: {
      "ui/ready": async () => context.onUiReady(),
      "ui/signIn": async () =>
        context.client.signInAndConnect().catch((err) => context.postError(String(err))),
      "ui/signOut": async () =>
        context.client.signOut().catch((err) => context.postError(String(err))),
      "ui/reconnect": async () => {
        try {
          await context.client.connectIfSignedIn();
        } catch (err) {
          context.postError(String(err));
        }
      },
      "ui/send": (msg) =>
        sendPlaintextIfConnected(context.client, {
          text: msg.text,
          clientMessageId: msg.clientMessageId,
        }),
      "ui/dm.open": (msg) =>
        runDirectMessageOpen({
          directMessages: context.directMessages,
          peer: msg.peer,
          client: context.client,
          postError: context.postError,
        }),
      "ui/dm.thread.select": (msg) =>
        runDirectMessageThreadSelect({
          directMessages: context.directMessages,
          dmId: msg.dmId,
          client: context.client,
          postError: context.postError,
        }),
      "ui/dm.send": async (msg) =>
        runDirectMessageSend({
          directMessages: context.directMessages,
          dmId: msg.dmId,
          text: msg.text,
          client: context.client,
          postError: context.postError,
        }),
      "ui/dm.peerKey.trust": async (msg) =>
        runDirectMessageTrustPeerKey({
          directMessages: context.directMessages,
          dmId: msg.dmId,
          postMessage: context.postMessage,
        }),
      "ui/link.open": async (msg) => runOpenLink({ href: msg.href, postError: context.postError }),
      "ui/profile.open": async (msg) =>
        runOpenProfile({
          githubProfiles: context.githubProfiles,
          login: msg.login,
          postMessage: context.postMessage,
        }),
      "ui/profile.openOnGitHub": async (msg) => openGitHubProfileInBrowser(msg.login),
      "ui/moderation.user.deny": (msg) =>
        runModerationAction({
          moderation: context.moderation,
          action: "deny",
          targetGithubUserId: msg.targetGithubUserId,
          client: context.client,
          postMessage: context.postMessage,
        }),
      "ui/moderation.user.allow": (msg) =>
        runModerationAction({
          moderation: context.moderation,
          action: "allow",
          targetGithubUserId: msg.targetGithubUserId,
          client: context.client,
          postMessage: context.postMessage,
        }),
    },
  });

  const routeServerEvent = createServerEventRouter({
    client: context.client,
    onNewMessage: context.onNewMessage,
    postMessage: context.postMessage,
    postError: context.postError,
    postDirectMessagesResult: (outbound, additional, error) =>
      postDirectMessagesResult({
        outbound,
        additional,
        error,
        postMessage: context.postMessage,
        postError: context.postError,
      }),
    directMessages: context.directMessages,
    presence: context.presence,
    moderation: context.moderation,
  });

  return { routeUiMessage, routeServerEvent };
}
