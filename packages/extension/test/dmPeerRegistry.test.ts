import { describe, expect, it } from "vitest";
import { DmPeerRegistry } from "../src/ui/chatView/directMessages/dmPeerRegistry.js";

describe("DmPeerRegistry", () => {
  it("registers peers and creates/upserts threads", () => {
    const registry = new DmPeerRegistry();
    const peer = {
      githubUserId: "2" as import("@vscode-chat/protocol").GithubUserId,
      login: "bob",
      avatarUrl: "https://example.test/b.png",
      roles: [],
    };
    const dmId = "dm:v1:1:2" as import("@vscode-chat/protocol").DmId;

    registry.registerPeer(peer);
    const thread = registry.getOrCreateThread(dmId, peer);

    expect(registry.getPeer(peer.githubUserId)?.login).toBe("bob");
    expect(thread.dmId).toBe(dmId);
    expect(registry.listThreads()).toHaveLength(1);
    expect(registry.getPeerForWelcome(dmId, peer.githubUserId)?.githubUserId).toBe(
      peer.githubUserId,
    );
  });
});
