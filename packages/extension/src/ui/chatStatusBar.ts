import * as vscode from "vscode";
import type { PresenceSnapshot, ServerEvent } from "@vscode-chat/protocol";
import type { ChatClientState } from "../core/chatClientCore.js";
import type { ChatClient } from "../net/chatClient.js";
import { deriveChatStatusBarPresentation } from "./chatStatusBarModel.js";

export class ChatStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private presence: PresenceSnapshot | undefined;
  private state: ChatClientState;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(client: ChatClient) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = "Vibe Chat";
    this.item.command = "vscodeChat.openChat";

    this.state = client.getState();

    this.disposables.push(
      client.onState((state) => {
        this.state = state;
        if (state.status !== "connected") this.presence = undefined;
        this.render();
      }),
      client.onEvent((event) => this.onServerEvent(event)),
      this.item,
    );

    this.render();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  private onServerEvent(event: ServerEvent): void {
    if (event.type !== "server/presence") return;
    this.presence = event.snapshot;
    this.render();
  }

  private render(): void {
    const presentation = deriveChatStatusBarPresentation(this.state, this.presence);

    if (!presentation.visible) {
      this.item.hide();
      return;
    }

    this.item.text = presentation.text;
    const md = new vscode.MarkdownString(presentation.tooltipMarkdown);
    md.isTrusted = false;
    this.item.tooltip = md;
    this.item.show();
  }
}
