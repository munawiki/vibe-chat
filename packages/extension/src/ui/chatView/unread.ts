import type * as vscode from "vscode";
import { deriveUnreadBadge, initialChatUnreadState, reduceChatUnread } from "../unreadBadge.js";

export class ChatViewUnread {
  private state = initialChatUnreadState();

  reset(): void {
    this.state = initialChatUnreadState();
  }

  onServerMessageNew(viewVisible: boolean): void {
    this.state = reduceChatUnread(this.state, { type: "server/message.new", viewVisible });
  }

  onViewVisibilityChanged(visible: boolean): void {
    this.state = reduceChatUnread(this.state, { type: "view/visibility.changed", visible });
  }

  applyToView(view: vscode.WebviewView | undefined): void {
    if (!view) return;
    view.badge = deriveUnreadBadge(this.state.unreadCount);
  }
}
