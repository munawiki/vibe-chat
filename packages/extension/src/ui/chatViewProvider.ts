import * as vscode from "vscode";
import type { GithubUserId, ServerEvent } from "@vscode-chat/protocol";
import { ChatClient } from "../net/chatClient.js";
import type { ExtensionBus } from "../bus/extensionBus.js";
import { UiInboundSchema, type ExtOutbound } from "../contract/webviewProtocol.js";
import { GitHubProfileService } from "../net/githubProfile.js";
import { unknownErrorToMessage } from "./chatView/errors.js";
import { openExternalHref, openGitHubProfileInBrowser } from "./chatView/external.js";
import { renderChatWebviewHtml } from "./chatView/html.js";
import { getBackendUrlFromConfig, isAutoConnectEnabledFromConfig } from "./chatView/config.js";
import { fetchProfileMessage } from "./chatView/profile.js";
import { ChatViewModeration } from "./chatView/moderation.js";
import { ChatViewDirectMessages } from "./chatView/directMessages.js";
import { ChatViewPresence } from "./chatView/presence.js";
import { ChatViewUnread } from "./chatView/unread.js";
import { deriveChatViewModel, type ChatViewModel } from "./viewModel.js";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "vscodeChat.chatView";

  private view: vscode.WebviewView | undefined;
  private uiReady = false;
  private pendingUiMessages: ExtOutbound[] = [];
  private readonly unread = new ChatViewUnread();
  private readonly presence = new ChatViewPresence();
  private readonly moderation = new ChatViewModeration();
  private readonly directMessages: ChatViewDirectMessages;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly githubProfiles: GitHubProfileService;
  private serverEventChain: Promise<void> = Promise.resolve();
  private unreadVisibilitySyncTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly serverEventMiddlewares: Array<(event: ServerEvent) => void | Promise<void>> = [
    (event) => this.middlewareUnread(event),
    (event) => this.middlewareGlobalChat(event),
    (event) => this.middlewareDirectMessages(event),
    (event) => this.middlewarePresence(event),
    (event) => this.middlewareModeration(event),
    (event) => this.middlewareErrors(event),
  ];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: ChatClient,
    private readonly output: vscode.LogOutputChannel,
    private readonly bus: ExtensionBus,
  ) {
    this.directMessages = new ChatViewDirectMessages(this.context, this.output);

    this.bus.on("auth/signedOut", () => {
      this.directMessages.resetAccountState();
      if (this.uiReady) this.postMessage(this.directMessages.getStateMessage());
    });
    this.bus.on("auth/githubAccount.changed", () => {
      this.directMessages.resetAccountState();
      if (this.uiReady) this.postMessage(this.directMessages.getStateMessage());
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
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    if (this.unreadVisibilitySyncTimer) {
      clearTimeout(this.unreadVisibilitySyncTimer);
      this.unreadVisibilitySyncTimer = undefined;
    }
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.dispose();
    this.view = view;
    this.uiReady = false;
    this.pendingUiMessages = [];
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
      this.client.onState((state) => {
        if (state.status !== "connected") {
          this.presence.reset();
          this.moderation.reset();
          this.directMessages.reset();
          this.serverEventChain = Promise.resolve();
          this.pendingUiMessages = [];
        } else {
          void this.directMessages.ensureIdentityPublished(this.client, state).catch((err) => {
            this.output.warn(`dm identity publish failed: ${String(err)}`);
          });
        }
        if (!this.uiReady) return;
        const vm = deriveChatViewModel(state, getBackendUrlFromConfig());
        this.postState(vm);
      }),
      this.client.onEvent((event) => this.onServerEvent(event)),
      view.onDidChangeVisibility(() => this.onViewVisibilityChanged()),
      view.onDidDispose(() => this.onViewDisposed()),
      view.webview.onDidReceiveMessage((msg: unknown) => this.onUiMessage(msg)),
    );

    this.onViewVisibilityChanged();
  }

  onConfigChanged(): void {
    if (!this.view) return;
    this.client.disconnect();
    if (!this.uiReady) return;
    this.postStateSnapshot();
    if (!isAutoConnectEnabledFromConfig()) return;
    this.client
      .connectIfSignedIn()
      .catch((err) => this.postError(`reconnect failed: ${unknownErrorToMessage(err)}`));
  }

  private async onUiMessage(msg: unknown): Promise<void> {
    const parsed = UiInboundSchema.safeParse(msg);
    if (!parsed.success) {
      this.output.warn("Invalid UI message schema.");
      return;
    }

    switch (parsed.data.type) {
      case "ui/ready":
        this.uiReady = true;
        this.syncUnreadOnUiReady();
        await this.client.refreshAuthState().catch((err) => this.postError(String(err)));
        this.postStateSnapshot();
        this.postMessage(this.directMessages.getStateMessage());
        this.postPresenceSnapshot();
        this.postModerationSnapshot();
        this.flushPendingUiMessages();
        if (isAutoConnectEnabledFromConfig()) {
          await this.client
            .connectIfSignedIn()
            .catch((err) => this.postError(`connect failed: ${unknownErrorToMessage(err)}`));
        }
        return;
      case "ui/signIn":
        await this.client.signInAndConnect().catch((err) => this.postError(String(err)));
        return;
      case "ui/signOut":
        await this.client.signOut().catch((err) => this.postError(String(err)));
        return;
      case "ui/reconnect":
        await this.client.connectIfSignedIn().catch((err) => this.postError(String(err)));
        return;
      case "ui/send":
        this.sendPlaintext({
          text: parsed.data.text,
          clientMessageId: parsed.data.clientMessageId,
        });
        return;
      case "ui/dm.open": {
        const err = this.directMessages.handleUiOpen(
          parsed.data.peer,
          this.client,
          this.client.getState(),
        );
        if (err) this.postError(err);
        return;
      }
      case "ui/dm.thread.select": {
        const err = this.directMessages.handleUiThreadSelect(
          parsed.data.dmId,
          this.client,
          this.client.getState(),
        );
        if (err) this.postError(err);
        return;
      }
      case "ui/dm.send": {
        const err = await this.directMessages.handleUiSend(
          parsed.data.dmId,
          parsed.data.text,
          this.client,
          this.client.getState(),
        );
        if (err) this.postError(err);
        return;
      }
      case "ui/dm.peerKey.trust": {
        const msg = await this.directMessages.handleUiTrustPeerKey(parsed.data.dmId);
        if (msg) this.postMessage(msg);
        return;
      }
      case "ui/link.open":
        await this.onLinkOpen(parsed.data.href);
        return;
      case "ui/profile.open":
        await this.onProfileOpen(parsed.data.login);
        return;
      case "ui/profile.openOnGitHub":
        await openGitHubProfileInBrowser(parsed.data.login);
        return;
      case "ui/moderation.user.deny":
        this.onModerationAction("deny", parsed.data.targetGithubUserId);
        return;
      case "ui/moderation.user.allow":
        this.onModerationAction("allow", parsed.data.targetGithubUserId);
        return;
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

  private onServerEvent(event: ServerEvent): void {
    const job = async (): Promise<void> => {
      await this.handleServerEvent(event);
    };

    const next = this.serverEventChain.then(job, job).catch((err) => {
      this.output.warn(`server event handler failed: ${String(err)}`);
    });
    this.serverEventChain = next;
  }

  private async handleServerEvent(event: ServerEvent): Promise<void> {
    for (const middleware of this.serverEventMiddlewares) {
      await middleware(event);
    }
  }

  private middlewareUnread(event: ServerEvent): void {
    if (event.type !== "server/message.new") return;
    this.onNewMessage();
  }

  private middlewareGlobalChat(event: ServerEvent): void {
    if (event.type === "server/welcome") {
      this.postMessage({ type: "ext/history", history: event.history });
      return;
    }

    if (event.type !== "server/message.new") return;
    this.postMessage({
      type: "ext/message",
      message: event.message,
      ...(event.clientMessageId ? { clientMessageId: event.clientMessageId } : {}),
    });
  }

  private async middlewareDirectMessages(event: ServerEvent): Promise<void> {
    if (event.type === "server/dm.welcome") {
      const dmWelcomeEvent = {
        dmId: event.dmId,
        peerGithubUserId: event.peerGithubUserId,
        history: event.history,
        ...(event.peerIdentity ? { peerIdentity: event.peerIdentity } : {}),
      };
      const result = await this.directMessages.handleServerWelcome({
        event: dmWelcomeEvent,
        clientState: this.client.getState(),
      });
      this.postDirectMessagesResult(result.outbound, result.history, result.error);
      return;
    }

    if (event.type !== "server/dm.message.new") return;
    const result = await this.directMessages.handleServerMessageNew({
      event: { message: event.message },
      clientState: this.client.getState(),
    });
    this.postDirectMessagesResult(result.outbound, result.message, result.error);
  }

  private middlewarePresence(event: ServerEvent): void {
    if (event.type !== "server/presence") return;
    const msg = this.presence.handleServerSnapshot(event.snapshot);
    this.postMessage(msg);
  }

  private middlewareModeration(event: ServerEvent): void {
    if (event.type === "server/moderation.snapshot") {
      const msg = this.moderation.handleServerSnapshot(event);
      this.postMessage(msg);
      return;
    }

    if (event.type === "server/moderation.user.denied") {
      const { userMessage, resolved } = this.moderation.handleServerUserDenied(
        event,
        this.client.getState(),
      );
      this.postMessage(userMessage);
      if (resolved) this.postMessage(resolved);
      return;
    }

    if (event.type !== "server/moderation.user.allowed") return;
    const { userMessage, resolved } = this.moderation.handleServerUserAllowed(
      event,
      this.client.getState(),
    );
    this.postMessage(userMessage);
    if (resolved) this.postMessage(resolved);
  }

  private middlewareErrors(event: ServerEvent): void {
    if (event.type !== "server/error") return;
    if (event.clientMessageId) {
      this.postMessage({
        type: "ext/message.send.error",
        clientMessageId: event.clientMessageId,
        code: event.code,
        ...(event.message ? { message: event.message } : {}),
        ...(typeof event.retryAfterMs === "number" ? { retryAfterMs: event.retryAfterMs } : {}),
      });
      return;
    }

    const moderation = this.moderation.handleServerError(event);
    if (moderation) this.postMessage(moderation);
    this.postError(event.message ?? event.code);
  }

  private onNewMessage(): void {
    const view = this.view;
    if (!view) return;

    this.unread.onServerMessageNew(view.visible);
    this.unread.applyToView(view);
  }

  private onViewVisibilityChanged(): void {
    this.scheduleUnreadVisibilitySync();
  }

  private onViewDisposed(): void {
    this.dispose();
    this.view = undefined;
    this.uiReady = false;
    this.pendingUiMessages = [];
  }

  private syncUnreadOnUiReady(): void {
    const view = this.view;
    if (!view) return;

    this.unread.onViewVisibilityChanged(view.visible);
    this.unread.applyToView(view);
  }

  private scheduleUnreadVisibilitySync(): void {
    const view = this.view;
    if (!view) return;

    if (this.unreadVisibilitySyncTimer) clearTimeout(this.unreadVisibilitySyncTimer);
    this.unreadVisibilitySyncTimer = setTimeout(() => {
      this.unreadVisibilitySyncTimer = undefined;
      if (this.view !== view) return;

      this.unread.onViewVisibilityChanged(view.visible);
      this.unread.applyToView(view);
    }, 0);
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
    if (!this.view) return;
    if (!this.uiReady) {
      this.pendingUiMessages.push(message);
      return;
    }
    void this.view.webview.postMessage(message);
  }

  private flushPendingUiMessages(): void {
    const view = this.view;
    if (!view || !this.uiReady) return;
    if (this.pendingUiMessages.length === 0) return;

    const pending = this.pendingUiMessages;
    this.pendingUiMessages = [];
    for (const msg of pending) {
      void view.webview.postMessage(msg);
    }
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
