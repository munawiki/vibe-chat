import * as vscode from "vscode";
import { ChatClient } from "../net/chatClient.js";
import type { PresenceSnapshot, ServerEvent } from "@vscode-chat/protocol";
import { ChatViewModel, deriveChatViewModel } from "./viewModel.js";
import { UiInboundSchema, type ExtOutbound } from "./webviewProtocol.js";
import { GitHubLoginSchema } from "../contract/githubProfile.js";
import { GitHubProfileService } from "../net/githubProfile.js";
import { deriveUnreadBadge, initialChatUnreadState, reduceChatUnread } from "./unreadBadge.js";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "vscodeChat.chatView";

  private view: vscode.WebviewView | undefined;
  private uiReady = false;
  private unread = initialChatUnreadState();
  private presence: PresenceSnapshot | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly githubProfiles: GitHubProfileService;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: ChatClient,
    private readonly output: vscode.LogOutputChannel,
  ) {
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
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.dispose();
    this.view = view;
    this.uiReady = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };

    view.webview.html = this.html(view.webview);

    this.disposables.push(
      this.client.onState((state) => {
        if (state.status !== "connected") this.presence = undefined;
        if (!this.uiReady) return;
        const vm = deriveChatViewModel(state, this.backendUrl());
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
    if (!vscode.workspace.getConfiguration("vscodeChat").get<boolean>("autoConnect", true)) return;
    this.client
      .connectIfSignedIn()
      .catch((err) => this.postError(`reconnect failed: ${String(err)}`));
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
        await this.client.refreshAuthState().catch((err) => this.postError(String(err)));
        this.postStateSnapshot();
        this.postPresenceSnapshot();
        if (vscode.workspace.getConfiguration("vscodeChat").get<boolean>("autoConnect", true)) {
          await this.client
            .connectIfSignedIn()
            .catch((err) => this.postError(`connect failed: ${String(err)}`));
        }
        return;
      case "ui/signIn":
        await this.client.signInAndConnect().catch((err) => this.postError(String(err)));
        return;
      case "ui/reconnect":
        await this.client.connectIfSignedIn().catch((err) => this.postError(String(err)));
        return;
      case "ui/send":
        this.client.sendMessage(parsed.data.text);
        return;
      case "ui/profile.open":
        await this.onProfileOpen(parsed.data.login);
        return;
      case "ui/profile.openOnGitHub":
        await this.onProfileOpenOnGitHub(parsed.data.login);
        return;
    }
  }

  private async onProfileOpen(login: string): Promise<void> {
    try {
      const profile = await this.githubProfiles.getProfile(login);
      this.postMessage({ type: "ext/profile.result", login, profile });
    } catch (err) {
      const message = err instanceof Error ? err.message : "github_profile_unknown_error";
      this.postMessage({ type: "ext/profile.error", login, message });
    }
  }

  private async onProfileOpenOnGitHub(login: string): Promise<void> {
    const parsed = GitHubLoginSchema.safeParse(login);
    if (!parsed.success) return;

    await vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${parsed.data}`));
  }

  private onServerEvent(event: ServerEvent): void {
    switch (event.type) {
      case "server/welcome":
        this.postMessage({ type: "ext/history", history: event.history });
        return;
      case "server/message.new":
        this.onNewMessage();
        this.postMessage({ type: "ext/message", message: event.message });
        return;
      case "server/presence":
        this.presence = event.snapshot;
        if (this.uiReady) this.postMessage({ type: "ext/presence", snapshot: event.snapshot });
        return;
      case "server/error":
        this.postError(event.message ?? event.code);
        return;
    }
  }

  private onNewMessage(): void {
    const view = this.view;
    if (!view) return;

    this.unread = reduceChatUnread(this.unread, {
      type: "server/message.new",
      viewVisible: view.visible,
    });

    this.applyUnreadBadge();
  }

  private onViewVisibilityChanged(): void {
    const view = this.view;
    if (!view) return;

    this.unread = reduceChatUnread(this.unread, {
      type: "view/visibility.changed",
      visible: view.visible,
    });

    this.applyUnreadBadge();
  }

  private onViewDisposed(): void {
    this.dispose();
    this.view = undefined;
    this.uiReady = false;
  }

  private applyUnreadBadge(): void {
    const view = this.view;
    if (!view) return;
    const badge = deriveUnreadBadge(this.unread.unreadCount);
    view.badge = badge;
  }

  private postStateSnapshot(): void {
    const current = this.client.getState();
    const vm = deriveChatViewModel(current, this.backendUrl());
    this.postState(vm);
  }

  private postPresenceSnapshot(): void {
    if (!this.presence) return;
    this.postMessage({ type: "ext/presence", snapshot: this.presence });
  }

  private postState(state: ChatViewModel): void {
    this.postMessage({ type: "ext/state", state });
  }

  private postError(message: string): void {
    this.postMessage({ type: "ext/error", message });
  }

  private postMessage(message: ExtOutbound): void {
    if (!this.view) return;
    void this.view.webview.postMessage(message);
  }

  private backendUrl(): string | undefined {
    try {
      return vscode.workspace.getConfiguration("vscodeChat").get<string>("backendUrl");
    } catch {
      return undefined;
    }
  }

  private html(webview: vscode.Webview): string {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "webview.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "webview.js"));
    const nonce = randomNonce();

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${cssUri.toString()}" />
    <title>VS Code Chat</title>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="status">
          <div class="line1" id="status1">disconnected</div>
          <div class="line2" id="status2"></div>
          <button class="identityChip" id="btnIdentity" type="button" style="display: none">
            <img class="identityAvatar" id="identityAvatar" alt="" />
            <span class="identityLogin" id="identityLogin"></span>
          </button>
          <button
            class="presenceButton"
            id="btnPresence"
            type="button"
            style="display: none"
            aria-expanded="false"
            aria-controls="presencePanel"
          >
            Online: —
          </button>
        </div>
        <div class="actions">
          <button class="secondary" id="btnSignIn">Sign in with GitHub</button>
          <button class="secondary" id="btnReconnect" style="display: none">Connect</button>
        </div>
      </div>
      <div class="messages" id="messages"></div>
      <div class="composer">
        <input id="input" type="text" maxlength="500" placeholder="Type a message…" disabled />
        <button id="btnSend" disabled>Send</button>
      </div>
      <div class="error" id="error"></div>
    </div>
    <div class="profileOverlay" id="profileOverlay" style="display: none">
      <div class="profileCard" id="profileCard" role="dialog" aria-modal="true" aria-label="GitHub Profile">
        <div class="profileHeader">
          <img class="profileAvatar" id="profileAvatar" alt="" />
          <div class="profileTitle">
            <div class="profileName" id="profileName"></div>
            <div class="profileLogin" id="profileLogin"></div>
          </div>
          <button class="profileClose" id="profileClose" aria-label="Close">×</button>
        </div>
        <div class="profileBody" id="profileBody"></div>
        <div class="profileFooter">
          <button class="secondary" id="profileOpenOnGitHub">Open on GitHub</button>
        </div>
        <div class="profileError" id="profileError" style="display: none"></div>
      </div>
    </div>
    <div class="presenceOverlay" id="presenceOverlay" style="display: none">
      <div class="presenceCard" id="presenceCard" role="dialog" aria-modal="true" aria-label="Online users">
        <div class="presenceHeader">
          <div class="presenceTitle">Online users</div>
          <button class="presenceClose" id="presenceClose" aria-label="Close">×</button>
        </div>
        <div class="presencePanel" id="presencePanel" role="list"></div>
      </div>
    </div>
    <script nonce="${nonce}" src="${jsUri.toString()}"></script>
  </body>
</html>`;
  }
}

function randomNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
