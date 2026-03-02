import { describe, expect, it, vi } from "vitest";
import type { ChatClientState } from "../src/net/chatClient.js";
import { AuthOrchestrator } from "../src/net/chatClient/authOrchestrator.js";

function disconnectedState(): ChatClientState {
  return { authStatus: "signedOut", status: "disconnected" };
}

describe("AuthOrchestrator", () => {
  it("delegates auth/connect lifecycle events to core runner", async () => {
    const run = vi.fn(() => Promise.resolve());
    const output = { info: vi.fn(), warn: vi.fn() } as unknown as import("vscode").LogOutputChannel;
    const orchestrator = new AuthOrchestrator({
      output,
      run,
      getState: disconnectedState,
      getBackendUrl: () => "http://example.test",
      onDidChangeGitHubSessions: () => ({ dispose: () => {} }),
    });

    await orchestrator.refreshAuthState();
    await orchestrator.signIn();
    await orchestrator.signOut();
    await orchestrator.connectInteractive();

    expect(run).toHaveBeenCalledWith({ type: "auth/refresh.requested" });
    expect(run).toHaveBeenCalledWith({ type: "ui/signIn" });
    expect(run).toHaveBeenCalledWith({ type: "ui/signOut" });
    expect(run).toHaveBeenCalledWith({
      type: "ui/connect",
      origin: "user",
      backendUrl: "http://example.test",
      interactive: true,
    });
  });

  it("returns connectIfSignedIn status from latest state", async () => {
    const run = vi.fn(() => Promise.resolve());
    const state: ChatClientState = {
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://example.test",
      user: {
        githubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
        login: "alice",
        avatarUrl: "https://example.test/a.png",
        roles: [],
      },
    };
    const orchestrator = new AuthOrchestrator({
      output: { info: vi.fn(), warn: vi.fn() } as unknown as import("vscode").LogOutputChannel,
      run,
      getState: () => state,
      getBackendUrl: () => "http://example.test",
      onDidChangeGitHubSessions: () => ({ dispose: () => {} }),
    });

    await expect(orchestrator.connectIfSignedIn()).resolves.toBe(true);
  });
});
