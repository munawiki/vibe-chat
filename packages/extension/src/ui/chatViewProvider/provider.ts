import * as vscode from "vscode";
import type { GithubUserId, ServerEvent } from "@vscode-chat/protocol";
import type { ChatClient, ChatClientState } from "../../net/chatClient.js";
import type { ExtensionBus } from "../../bus/extensionBus.js";
import type { ExtOutbound } from "../../contract/webviewProtocol.js";
import { GitHubProfileService } from "../../net/githubProfile.js";
import { unknownErrorToMessage } from "../chatView/errors.js";
import { openExternalHref, openGitHubProfileInBrowser } from "../chatView/external.js";
import { renderChatWebviewHtml } from "../chatView/html.js";
import { getBackendUrlFromConfig, isAutoConnectEnabledFromConfig } from "../chatView/config.js";
import { fetchProfileMessage } from "../chatView/profile.js";
import { ChatViewModeration } from "../chatView/moderation.js";
import { ChatViewDirectMessages } from "../chatView/directMessages.js";
import { ChatViewPresence } from "../chatView/presence.js";
import { ChatViewUnread } from "../chatView/unread.js";
import { deriveChatViewModel, type ChatViewModel } from "../viewModel.js";
import { WebviewPostman } from "./postman.js";
import { createUiMessageRouter } from "./uiRouter.js";
import { UnreadVisibilitySync } from "./unreadSync.js";
import { createServerEventRouter } from "./serverEventRouter.js";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "vscodeChat.chatView";

  private view: vscode.WebviewView | undefined;
  private readonly postman = new WebviewPostman();

  private readonly unread = new ChatViewUnread();
  private readonly unreadSync = new UnreadVisibilitySync(this.unread);
  private readonly presence = new ChatViewPresence();
  private readonly moderation = new ChatViewModeration();
  private readonly directMessages: ChatViewDirectMessages;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly githubProfiles: GitHubProfileService;

  private serverEventChain: Promise<void> = Promise.resolve();
  private readonly routeUiMessage: (msg: unknown) => Promise<void>;
  private readonly routeServerEvent: (event: ServerEvent) => Promise<void>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: ChatClient,
    private readonly output: vscode.LogOutputChannel,
    private readonly bus: ExtensionBus,
  ) {
    this.directMessages = new ChatViewDirectMessages(this.context, this.output);

    this.bus.on("auth/signedOut", () => {
      this.directMessages.resetAccountState();
      if (this.postman.isUiReady()) this.postman.postMessage(this.directMessages.getStateMessage());
    });
    this.bus.on("auth/githubAccount.changed", () => {
      this.directMessages.resetAccountState();
      if (this.postman.isUiReady()) this.postman.postMessage(this.directMessages.getStateMessage());
    });

    this.githubProfiles = new GitHubProfileService({
      getAccessToken: async () => {
        try {
          const session = await vscode.authentication.getSession("github", ["read:user"], {
            silent: true,
          });
          return session?.accessToken;
        } catch {
          return undefined;
        }
      },
      userAgent: "vscode-chat-extension",
    });

    this.routeUiMessage = createUiMessageRouter({
      output: this.output,
      handlers: {
        "ui/ready": async () => this.onUiReady(),
        "ui/signIn": async () =>
          this.client.signInAndConnect().catch((err) => this.postError(String(err))),
        "ui/signOut": async () => this.client.signOut().catch((err) => this.postError(String(err))),
        "ui/reconnect": async () => {
          try {
            await this.client.connectIfSignedIn();
          } catch (err) {
            this.postError(String(err));
          }
        },
        "ui/send": (msg) =>
          this.sendPlaintext({ text: msg.text, clientMessageId: msg.clientMessageId }),
        "ui/dm.open": (msg) => this.onDirectMessageOpen(msg.peer),
        "ui/dm.thread.select": (msg) => this.onDirectMessageThreadSelect(msg.dmId),
        "ui/dm.send": async (msg) => this.onDirectMessageSend(msg.dmId, msg.text),
        "ui/dm.peerKey.trust": async (msg) => this.onDirectMessageTrustPeerKey(msg.dmId),
        "ui/link.open": async (msg) => this.onLinkOpen(msg.href),
        "ui/profile.open": async (msg) => this.onProfileOpen(msg.login),
        "ui/profile.openOnGitHub": async (msg) => openGitHubProfileInBrowser(msg.login),
        "ui/moderation.user.deny": (msg) => this.onModerationAction("deny", msg.targetGithubUserId),
        "ui/moderation.user.allow": (msg) =>
          this.onModerationAction("allow", msg.targetGithubUserId),
      },
    });

    this.routeServerEvent = createServerEventRouter({
      client: this.client,
      onNewMessage: () => this.onNewMessage(),
      postMessage: (message) => this.postMessage(message),
      postError: (message) => this.postError(message),
      postDirectMessagesResult: (outbound, additional, error) =>
        this.postDirectMessagesResult(outbound, additional, error),
      directMessages: this.directMessages,
      presence: this.presence,
      moderation: this.moderation,
    });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.unreadSync.dispose();
    this.postman.dispose();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.dispose();
    this.view = view;
    this.postman.reset(view);
    this.unreadSync.attachView(view);

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };

    view.webview.html = renderChatWebviewHtml({
      webview: view.webview,
      extensionUri: this.context.extensionUri,
      extensionMode: this.context.extensionMode,
    });

    this.disposables.push(
      this.client.onState((state) => this.onClientState(state)),
      this.client.onEvent((event) => this.enqueueServerEvent(event)),
      view.onDidChangeVisibility(() => this.onViewVisibilityChanged()),
      view.onDidDispose(() => this.onViewDisposed()),
      view.webview.onDidReceiveMessage((msg: unknown) => this.onUiMessage(msg)),
    );

    this.onViewVisibilityChanged();
  }

  onConfigChanged(): void {
    if (!this.view) return;
    this.client.disconnect();
    if (!this.postman.isUiReady()) return;
    this.postStateSnapshot();
    if (!isAutoConnectEnabledFromConfig()) return;
    this.client
      .connectIfSignedIn()
      .catch((err) => this.postError(`reconnect failed: ${unknownErrorToMessage(err)}`));
  }

  private async onUiMessage(msg: unknown): Promise<void> {
    await this.routeUiMessage(msg);
  }

  private async onUiReady(): Promise<void> {
    this.postman.markUiReady();
    this.unreadSync.onUiReady();
    await this.client.refreshAuthState().catch((err) => this.postError(String(err)));
    this.postStateSnapshot();
    this.postMessage(this.directMessages.getStateMessage());
    this.postPresenceSnapshot();
    this.postModerationSnapshot();
    this.postman.flushPendingUiMessages();
    if (isAutoConnectEnabledFromConfig()) {
      await this.client
        .connectIfSignedIn()
        .catch((err) => this.postError(`connect failed: ${unknownErrorToMessage(err)}`));
    }
  }

  private onModerationAction(action: "deny" | "allow", targetGithubUserId: GithubUserId): void {
    const result = this.moderation.handleUiAction(
      action,
      targetGithubUserId,
      this.client.getState(),
    );
    this.postMessage(result.outbound);
    if (!result.send) return;
    if (result.send.action === "deny")
      this.client.sendModerationDeny(result.send.targetGithubUserId);
    else this.client.sendModerationAllow(result.send.targetGithubUserId);
  }

  private async onLinkOpen(href: string): Promise<void> {
    const result = await openExternalHref(href);
    if (!result.ok) this.postError(result.message);
  }

  private async onProfileOpen(login: string): Promise<void> {
    const message = await fetchProfileMessage(this.githubProfiles, login);
    this.postMessage(message);
  }

  private onDirectMessageOpen(peer: Parameters<ChatViewDirectMessages["handleUiOpen"]>[0]): void {
    const err = this.directMessages.handleUiOpen(peer, this.client, this.client.getState());
    if (err) this.postError(err);
  }

  private onDirectMessageThreadSelect(
    dmId: Parameters<ChatViewDirectMessages["handleUiThreadSelect"]>[0],
  ): void {
    const err = this.directMessages.handleUiThreadSelect(dmId, this.client, this.client.getState());
    if (err) this.postError(err);
  }

  private async onDirectMessageSend(
    dmId: Parameters<ChatViewDirectMessages["handleUiSend"]>[0],
    text: Parameters<ChatViewDirectMessages["handleUiSend"]>[1],
  ): Promise<void> {
    const err = await this.directMessages.handleUiSend(
      dmId,
      text,
      this.client,
      this.client.getState(),
    );
    if (err) this.postError(err);
  }

  private async onDirectMessageTrustPeerKey(
    dmId: Parameters<ChatViewDirectMessages["handleUiTrustPeerKey"]>[0],
  ): Promise<void> {
    const msg = await this.directMessages.handleUiTrustPeerKey(dmId);
    if (msg) this.postMessage(msg);
  }

  private onClientState(state: ChatClientState): void {
    if (state.status === "connected") {
      void this.directMessages.ensureIdentityPublished(this.client, state).catch((err) => {
        this.output.warn(`dm identity publish failed: ${String(err)}`);
      });
    } else {
      this.presence.reset();
      this.moderation.reset();
      this.directMessages.reset();
      this.serverEventChain = Promise.resolve();
      this.postman.clearPending();
    }
    if (!this.postman.isUiReady()) return;
    const vm = deriveChatViewModel(state, getBackendUrlFromConfig());
    this.postState(vm);
  }

  private enqueueServerEvent(event: ServerEvent): void {
    const job = async (): Promise<void> => {
      await this.routeServerEvent(event);
    };

    const next = this.serverEventChain.then(job, job).catch((err) => {
      this.output.warn(`server event handler failed: ${String(err)}`);
    });
    this.serverEventChain = next;
  }

  private onNewMessage(): void {
    this.unreadSync.onServerMessageNew();
  }

  private onViewVisibilityChanged(): void {
    this.unreadSync.onViewVisibilityChanged();
  }

  private onViewDisposed(): void {
    this.dispose();
    this.view = undefined;
  }

  private postStateSnapshot(): void {
    const current = this.client.getState();
    const vm = deriveChatViewModel(current, getBackendUrlFromConfig());
    this.postState(vm);
  }

  private postPresenceSnapshot(): void {
    const msg = this.presence.getSnapshotMessage();
    if (msg) this.postMessage(msg);
  }

  private postModerationSnapshot(): void {
    const msg = this.moderation.getSnapshotMessage();
    if (msg) this.postMessage(msg);
  }

  private postState(state: ChatViewModel): void {
    this.postMessage({ type: "ext/state", state });
  }

  private postError(message: string): void {
    this.postMessage({ type: "ext/error", message });
  }

  private postMessage(message: ExtOutbound): void {
    this.postman.postMessage(message);
  }

  private postDirectMessagesResult(
    outbound: ExtOutbound[],
    additional: ExtOutbound | undefined,
    error: string | undefined,
  ): void {
    for (const msg of outbound) this.postMessage(msg);
    if (additional) this.postMessage(additional);
    if (error) this.postError(error);
  }

  private sendPlaintext(options: { text: string; clientMessageId: string }): void {
    const state = this.client.getState();
    if (state.status !== "connected") return;
    this.client.sendMessage({ text: options.text, clientMessageId: options.clientMessageId });
  }
}
