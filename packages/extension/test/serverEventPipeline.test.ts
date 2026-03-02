import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type ServerEvent } from "@vscode-chat/protocol";
import { ServerEventPipeline } from "../src/ui/chatViewProvider/serverEventPipeline.js";

function messageEvent(id: string): ServerEvent {
  return {
    version: PROTOCOL_VERSION,
    type: "server/message.new",
    message: {
      id,
      user: {
        githubUserId: "1" as import("@vscode-chat/protocol").GithubUserId,
        login: "alice",
        avatarUrl: "https://example.test/alice.png",
        roles: [],
      },
      text: "hello",
      createdAt: new Date().toISOString(),
    },
  };
}

describe("ServerEventPipeline", () => {
  it("processes events sequentially", async () => {
    const calls: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const pipeline = new ServerEventPipeline({
      output: { warn: vi.fn() } as unknown as import("vscode").LogOutputChannel,
      routeServerEvent: async (event) => {
        calls.push(event.type);
        if (calls.length === 1) await firstDone;
      },
    });

    pipeline.enqueue(messageEvent("1"));
    pipeline.enqueue(messageEvent("2"));
    await Promise.resolve();

    expect(calls).toEqual(["server/message.new"]);
    releaseFirst?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["server/message.new", "server/message.new"]);
  });
});
