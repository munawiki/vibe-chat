import { describe, expect, it } from "vitest";
import { StateSnapshotSync } from "../src/ui/chatViewProvider/stateSnapshotSync.js";

describe("StateSnapshotSync", () => {
  it("posts all snapshots in a deterministic order", () => {
    const posted: unknown[] = [];
    const sync = new StateSnapshotSync({
      client: {
        getState: () => ({ authStatus: "signedOut", status: "disconnected" }),
      } as unknown as import("../src/net/chatClient.js").ChatClient,
      directMessages: {
        getStateMessage: () => ({ type: "ext/dm.state", threads: [] }),
      },
      presence: {
        getSnapshotMessage: () => ({ type: "ext/presence", snapshot: [] }),
      } as unknown as import("../src/ui/chatView/presence.js").ChatViewPresence,
      moderation: {
        getSnapshotMessage: () => ({
          type: "ext/moderation.snapshot",
          operatorDeniedGithubUserIds: [],
          roomDeniedGithubUserIds: [],
        }),
      } as unknown as import("../src/ui/chatView/moderation.js").ChatViewModeration,
      getBackendUrl: () => "http://example.test",
      postMessage: (msg) => posted.push(msg),
    });

    sync.postAllSnapshots();

    expect(posted.map((item: { type: string }) => item.type)).toEqual([
      "ext/state",
      "ext/dm.state",
      "ext/presence",
      "ext/moderation.snapshot",
    ]);
  });
});
