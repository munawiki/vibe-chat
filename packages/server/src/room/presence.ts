import { PROTOCOL_VERSION } from "@vscode-chat/protocol";
import type { ServerEvent } from "@vscode-chat/protocol";
import { derivePresenceSnapshotFromWebSockets } from "../presence.js";
import { PresenceBroadcastCoalescer } from "../policy/presenceBroadcastPolicy.js";
import { PRESENCE_BROADCAST_COALESCE_WINDOW_MS } from "./constants.js";

export class ChatRoomPresence {
  private readonly coalescer: PresenceBroadcastCoalescer<WebSocket>;

  constructor(
    private readonly getWebSockets: () => WebSocket[],
    private readonly broadcast: (event: ServerEvent) => void,
  ) {
    this.coalescer = new PresenceBroadcastCoalescer<WebSocket>(
      PRESENCE_BROADCAST_COALESCE_WINDOW_MS,
      (exclude) => {
        this.broadcastNow(exclude);
      },
    );
  }

  request(opts?: { exclude?: WebSocket }): void {
    this.coalescer.request(opts);
  }

  private broadcastNow(exclude: ReadonlySet<WebSocket>): void {
    const snapshot = derivePresenceSnapshotFromWebSockets(
      this.getWebSockets(),
      exclude.size > 0 ? { exclude } : undefined,
    );
    this.broadcast({
      version: PROTOCOL_VERSION,
      type: "server/presence",
      snapshot,
    } satisfies ServerEvent);
  }
}
