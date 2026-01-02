import { describe, expect, it } from "vitest";
import { ExtOutboundSchema } from "../src/ui/webviewProtocol.js";

describe("webviewProtocol", () => {
  it("accepts ext/presence snapshot", () => {
    const result = ExtOutboundSchema.safeParse({
      type: "ext/presence",
      snapshot: [
        {
          user: { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" },
          connections: 2,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid ext/presence payload", () => {
    const result = ExtOutboundSchema.safeParse({
      type: "ext/presence",
      snapshot: [
        {
          user: { githubUserId: "123", login: "octocat", avatarUrl: "not-a-url" },
          connections: 0,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
