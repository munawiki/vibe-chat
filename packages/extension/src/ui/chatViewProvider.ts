import * as vscode from "vscode";
import { ChatClient, ChatClientState } from "../net/chatClient.js";
import { ServerEvent } from "@vscode-chat/protocol";

type UiInbound =
  | { type: "ui/ready" }
  | { type: "ui/signIn" }
  | { type: "ui/reconnect" }
  | { type: "ui/send"; text: string };

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "vscodeChat.chatView";

  private view: vscode.WebviewView | undefined;
  private uiReady = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: ChatClient,
    private readonly output: vscode.LogOutputChannel,
  ) {}

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
        if (!this.uiReady) return;
        const backendUrl = this.backendUrl();
        this.postState({
          ...state,
          ...(backendUrl ? { backendUrl } : {}),
        });
      }),
      this.client.onEvent((event) => this.onServerEvent(event)),
      view.webview.onDidReceiveMessage((msg: UiInbound) => this.onUiMessage(msg)),
    );
  }

  onConfigChanged(): void {
    if (!this.view) return;
    this.client.disconnect();
    if (!this.uiReady) return;
    this.postStateSnapshot();
    if (!vscode.workspace.getConfiguration("vscodeChat").get<boolean>("autoConnect", true)) return;
    this.client.connect().catch((err) => this.postError(`reconnect failed: ${String(err)}`));
  }

  private async onUiMessage(msg: UiInbound): Promise<void> {
    switch (msg.type) {
      case "ui/ready":
        this.uiReady = true;
        this.postStateSnapshot();
        if (vscode.workspace.getConfiguration("vscodeChat").get<boolean>("autoConnect", true)) {
          await this.client
            .connect()
            .catch((err) => this.postError(`connect failed: ${String(err)}`));
        }
        return;
      case "ui/signIn":
        await this.client.signIn().catch((err) => this.postError(String(err)));
        return;
      case "ui/reconnect":
        await this.client.connect().catch((err) => this.postError(String(err)));
        return;
      case "ui/send":
        this.client.sendMessage(msg.text);
        return;
    }
  }

  private onServerEvent(event: unknown): void {
    if (!this.view) return;
    const e = event as ServerEvent;
    switch (e.type) {
      case "server/welcome":
        this.view.webview.postMessage({ type: "ext/history", history: e.history });
        return;
      case "server/message.new":
        this.view.webview.postMessage({ type: "ext/message", message: e.message });
        return;
      case "server/error":
        this.postError(e.message ?? e.code);
        return;
    }
  }

  private postStateSnapshot(): void {
    const current = this.client.getState();
    const backendUrl = this.backendUrl();
    if (backendUrl) {
      this.postState({ ...current, backendUrl });
      return;
    }
    this.postState(current);
  }

  private postState(state: ChatClientState): void {
    if (!this.view) return;
    this.view.webview.postMessage({ type: "ext/state", state });
  }

  private postError(message: string): void {
    if (!this.view) return;
    this.view.webview.postMessage({ type: "ext/error", message });
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
    <link rel="stylesheet" href="${cssUri}" />
    <title>VS Code Chat</title>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="status">
          <div class="line1" id="status1">disconnected</div>
          <div class="line2" id="status2"></div>
        </div>
        <div class="actions">
          <button class="secondary" id="btnSignIn">Sign in</button>
          <button class="secondary" id="btnReconnect">Reconnect</button>
        </div>
      </div>
      <div class="messages" id="messages"></div>
      <div class="composer">
        <input id="input" type="text" maxlength="500" placeholder="Type a message…" disabled />
        <button id="btnSend" disabled>Send</button>
      </div>
      <div class="error" id="error"></div>
    </div>
    <script nonce="${nonce}" src="${jsUri}"></script>
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
