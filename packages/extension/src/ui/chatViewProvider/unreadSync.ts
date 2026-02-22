import type * as vscode from "vscode";
import type { ChatViewUnread } from "../chatView/unread.js";

export class UnreadVisibilitySync {
  private view: vscode.WebviewView | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly unread: ChatViewUnread) {}

  dispose(): void {
    this.view = undefined;
    this.clearTimer();
  }

  attachView(view: vscode.WebviewView): void {
    this.view = view;
  }

  onUiReady(): void {
    const view = this.view;
    if (!view) return;

    this.unread.onViewVisibilityChanged(view.visible);
    this.unread.applyToView(view);
  }

  onViewVisibilityChanged(): void {
    const view = this.view;
    if (!view) return;

    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.view !== view) return;

      this.unread.onViewVisibilityChanged(view.visible);
      this.unread.applyToView(view);
    }, 0);
  }

  onServerMessageNew(): void {
    const view = this.view;
    if (!view) return;

    this.unread.onServerMessageNew(view.visible);
    this.unread.applyToView(view);
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
