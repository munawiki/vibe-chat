import type { PresenceSnapshot } from "@vscode-chat/protocol";
import type { ExtPresenceMsg } from "../../contract/webviewProtocol.js";

export class ChatViewPresence {
  private snapshot: PresenceSnapshot | undefined;

  reset(): void {
    this.snapshot = undefined;
  }

  handleServerSnapshot(snapshot: PresenceSnapshot): ExtPresenceMsg {
    this.snapshot = snapshot;
    return { type: "ext/presence", snapshot };
  }

  getSnapshotMessage(): ExtPresenceMsg | undefined {
    if (!this.snapshot) return undefined;
    return { type: "ext/presence", snapshot: this.snapshot };
  }
}
