import * as vscode from "vscode";
import type { ServerEvent } from "@vscode-chat/protocol";
import type { ChatClient, ChatClientState } from "../../net/chatClient.js";
import type { ExtensionBus } from "../../bus/extensionBus.js";
import type { ExtOutbound } from "../../contract/protocol/index.js";
import { GitHubProfileService } from "../../net/githubProfile/service.js";
import { unknownErrorToMessage } from "../chatView/errors.js";
import { renderChatWebviewHtml } from "../chatView/html.js";
import { getBackendUrlFromConfig, isAutoConnectEnabledFromConfig } from "../chatView/config.js";
import { ChatViewModeration } from "../chatView/moderation.js";
import { ChatViewDirectMessages } from "../chatView/directMessages.js";
import { DmTrustedKeyStore } from "../chatView/directMessagesTrustStore.js";
import { DmKeypairScope } from "../chatView/directMessages/dmKeypairScope.js";
import { DmPeerRegistry } from "../chatView/directMessages/dmPeerRegistry.js";
import { ChatViewPresence } from "../chatView/presence.js";
import { ChatViewUnread } from "../chatView/unread.js";
import { deriveChatViewModel } from "../viewModel.js";
import { WebviewPostman } from "./postman.js";
import { UnreadVisibilitySync } from "./unreadSync.js";
import { createProviderRouters } from "./providerRouters.js";
import { ServerEventPipeline } from "./serverEventPipeline.js";
import { StateSnapshotSync } from "./stateSnapshotSync.js";
import { emitDmSecretMigrationDiagnostic } from "../chatView/directMessagesDiagnostics.js";

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

  private readonly routeUiMessage: (msg: unknown) => Promise<void>;
  private readonly routeServerEvent: (event: ServerEvent) => Promise<void>;
  private readonly serverEventPipeline: ServerEventPipeline;
  private readonly stateSnapshotSync: StateSnapshotSync;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: ChatClient,
    private readonly output: vscode.LogOutputChannel,
    private readonly bus: ExtensionBus,
  ) {
    const trustedPeerKeys = new DmTrustedKeyStore(this.context.globalState, this.output);
    const keypairScope = new DmKeypairScope({
      secrets: this.context.secrets,
      trustedPeerKeys,
      onSecretMigrationDiagnostic: (event) =>
        emitDmSecretMigrationDiagnostic({ output: this.output, event }),
    });
    this.directMessages = new ChatViewDirectMessages({
      output: this.output,
      trustedPeerKeys,
      keypairScope,
      peerRegistry: new DmPeerRegistry(),
    });

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

    const routers = createProviderRouters({
      client: this.client,
      output: this.output,
      directMessages: this.directMessages,
      moderation: this.moderation,
      presence: this.presence,
      githubProfiles: this.githubProfiles,
      onUiReady: () => this.onUiReady(),
      onNewMessage: () => this.onNewMessage(),
      postMessage: (message) => this.postMessage(message),
      postError: (message) => this.postError(message),
    });
    this.routeUiMessage = routers.routeUiMessage;
    this.routeServerEvent = routers.routeServerEvent;
    this.serverEventPipeline = new ServerEventPipeline({
      output: this.output,
      routeServerEvent: (event) => this.routeServerEvent(event),
    });
    this.stateSnapshotSync = new StateSnapshotSync({
      client: this.client,
      directMessages: this.directMessages,
      moderation: this.moderation,
      presence: this.presence,
      getBackendUrl: () => getBackendUrlFromConfig(),
      postMessage: (message) => this.postMessage(message),
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
    this.stateSnapshotSync.postStateSnapshot();
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
    this.stateSnapshotSync.postAllSnapshots();
    this.postman.flushPendingUiMessages();
    if (isAutoConnectEnabledFromConfig()) {
      await this.client
        .connectIfSignedIn()
        .catch((err) => this.postError(`connect failed: ${unknownErrorToMessage(err)}`));
    }
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
      this.serverEventPipeline.reset();
      this.postman.clearPending();
    }
    if (!this.postman.isUiReady()) return;
    const vm = deriveChatViewModel(state, getBackendUrlFromConfig());
    this.postMessage({ type: "ext/state", state: vm });
  }

  private enqueueServerEvent(event: ServerEvent): void {
    this.serverEventPipeline.enqueue(event);
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

  private postError(message: string): void {
    this.postMessage({ type: "ext/error", message });
  }

  private postMessage(message: ExtOutbound): void {
    this.postman.postMessage(message);
  }
}
