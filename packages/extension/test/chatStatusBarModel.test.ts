import { describe, expect, it } from "vitest";
import { AuthUserSchema, PresenceSnapshotSchema } from "@vscode-chat/protocol";
import { deriveChatStatusBarPresentation } from "../src/ui/chatStatusBarModel.js";

describe("deriveChatStatusBarPresentation", () => {
  it("hides when disconnected", () => {
    const presentation = deriveChatStatusBarPresentation({
      authStatus: "signedIn",
      status: "disconnected",
    });

    expect(presentation.visible).toBe(false);
  });

  it("shows connecting with unknown online count", () => {
    const presentation = deriveChatStatusBarPresentation({
      authStatus: "signedIn",
      status: "connecting",
      backendUrl: "http://127.0.0.1:8787",
    });

    expect(presentation.visible).toBe(true);
    expect(presentation.text).toContain("Connecting");
    expect(presentation.text).toContain("Online: —");
    expect(presentation.tooltipMarkdown).toContain("Online: `—`");
  });

  it("shows connected with online count and list", () => {
    const alice = AuthUserSchema.parse({
      githubUserId: "1",
      login: "alice",
      avatarUrl: "https://example.com/a.png",
      roles: [],
    });
    const bob = AuthUserSchema.parse({
      githubUserId: "2",
      login: "bob",
      avatarUrl: "https://example.com/b.png",
      roles: [],
    });

    const presentation = deriveChatStatusBarPresentation(
      {
        authStatus: "signedIn",
        status: "connected",
        backendUrl: "http://127.0.0.1:8787",
        user: alice,
      },
      PresenceSnapshotSchema.parse([
        { user: alice, connections: 1 },
        { user: bob, connections: 2 },
      ]),
    );

    expect(presentation.visible).toBe(true);
    expect(presentation.text).not.toContain("Connected");
    expect(presentation.text).toContain("Online: 2");
    expect(presentation.tooltipMarkdown).toContain("- `alice`");
    expect(presentation.tooltipMarkdown).toContain("- `bob` ×2");
  });

  it("caps list to topN and shows overflow", () => {
    const presence = PresenceSnapshotSchema.parse(
      Array.from({ length: 12 }, (_, i) => ({
        user: {
          githubUserId: String(i + 1),
          login: `user-${i + 1}`,
          avatarUrl: "https://example.com/a.png",
          roles: [],
        },
        connections: 1,
      })),
    );

    const presentation = deriveChatStatusBarPresentation(
      {
        authStatus: "signedIn",
        status: "connected",
        backendUrl: "http://127.0.0.1:8787",
        user: AuthUserSchema.parse({
          githubUserId: "1",
          login: "user-1",
          avatarUrl: "https://example.com/a.png",
          roles: [],
        }),
      },
      presence,
      { topN: 10 },
    );

    expect(presentation.tooltipMarkdown).toContain("- …and 2 more");
    expect(presentation.tooltipMarkdown).toContain("- `user-10`");
    expect(presentation.tooltipMarkdown).not.toContain("- `user-11`");
  });
});
