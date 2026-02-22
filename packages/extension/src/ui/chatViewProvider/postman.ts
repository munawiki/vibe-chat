import type * as vscode from "vscode";
import type { ExtOutbound } from "../../contract/webviewProtocol.js";

export class WebviewPostman {
  private view: vscode.WebviewView | undefined;
  private uiReady = false;
  private pendingUiMessages: ExtOutbound[] = [];

  reset(view: vscode.WebviewView): void {
    this.view = view;
    this.uiReady = false;
    this.pendingUiMessages = [];
  }

  dispose(): void {
    this.view = undefined;
    this.uiReady = false;
    this.pendingUiMessages = [];
  }

  isUiReady(): boolean {
    return this.uiReady;
  }

  markUiReady(): void {
    this.uiReady = true;
  }

  clearPending(): void {
    this.pendingUiMessages = [];
  }

  postMessage(message: ExtOutbound): void {
    const view = this.view;
    if (!view) return;
    if (!this.uiReady) {
      this.pendingUiMessages.push(message);
      return;
    }
    void view.webview.postMessage(message);
  }

  flushPendingUiMessages(): void {
    const view = this.view;
    if (!view || !this.uiReady) return;
    if (this.pendingUiMessages.length === 0) return;

    const pending = this.pendingUiMessages;
    this.pendingUiMessages = [];
    for (const msg of pending) {
      void view.webview.postMessage(msg);
    }
  }
}
