import { describe, expect, it } from "vitest";
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
    const presentation = deriveChatStatusBarPresentation(
      {
        authStatus: "signedIn",
        status: "connected",
        backendUrl: "http://127.0.0.1:8787",
        user: { githubUserId: "1", login: "alice", avatarUrl: "https://example.com/a.png" },
      },
      [
        {
          user: { githubUserId: "1", login: "alice", avatarUrl: "https://example.com/a.png" },
          connections: 1,
        },
        {
          user: { githubUserId: "2", login: "bob", avatarUrl: "https://example.com/b.png" },
          connections: 2,
        },
      ],
    );

    expect(presentation.visible).toBe(true);
    expect(presentation.text).not.toContain("Connected");
    expect(presentation.text).toContain("Online: 2");
    expect(presentation.tooltipMarkdown).toContain("- `alice`");
    expect(presentation.tooltipMarkdown).toContain("- `bob` ×2");
  });

  it("caps list to topN and shows overflow", () => {
    const presence = Array.from({ length: 12 }, (_, i) => ({
      user: {
        githubUserId: String(i + 1),
        login: `user-${i + 1}`,
        avatarUrl: "https://example.com/a.png",
      },
      connections: 1,
    }));

    const presentation = deriveChatStatusBarPresentation(
      {
        authStatus: "signedIn",
        status: "connected",
        backendUrl: "http://127.0.0.1:8787",
        user: { githubUserId: "1", login: "user-1", avatarUrl: "https://example.com/a.png" },
      },
      presence,
      { topN: 10 },
    );

    expect(presentation.tooltipMarkdown).toContain("- …and 2 more");
    expect(presentation.tooltipMarkdown).toContain("- `user-10`");
    expect(presentation.tooltipMarkdown).not.toContain("- `user-11`");
  });
});
