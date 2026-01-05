import { describe, expect, it } from "vitest";
import { ExtOutboundSchema, UiInboundSchema } from "../src/contract/webviewProtocol.js";

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

  it("accepts ui/link.open", () => {
    const result = UiInboundSchema.safeParse({ type: "ui/link.open", href: "https://example.com" });
    expect(result.success).toBe(true);
  });

  it("accepts ui/send with clientMessageId", () => {
    const result = UiInboundSchema.safeParse({
      type: "ui/send",
      text: "hello",
      clientMessageId: "f2d6aa4f-2f60-4c25-b9f5-7a7b6a7bd3b0",
    });
    expect(result.success).toBe(true);
  });

  it("accepts ext/message with clientMessageId", () => {
    const result = ExtOutboundSchema.safeParse({
      type: "ext/message",
      clientMessageId: "f2d6aa4f-2f60-4c25-b9f5-7a7b6a7bd3b0",
      message: {
        id: "m1",
        user: { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" },
        text: "hello",
        createdAt: new Date().toISOString(),
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts ext/message.send.error", () => {
    const result = ExtOutboundSchema.safeParse({
      type: "ext/message.send.error",
      clientMessageId: "f2d6aa4f-2f60-4c25-b9f5-7a7b6a7bd3b0",
      code: "rate_limited",
      message: "Too many messages",
      retryAfterMs: 10_000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts DM messages", () => {
    const open = UiInboundSchema.safeParse({
      type: "ui/dm.open",
      peer: {
        githubUserId: "123",
        login: "octocat",
        avatarUrl: "https://example.com/a.png",
        roles: [],
      },
    });
    expect(open.success).toBe(true);

    const send = UiInboundSchema.safeParse({
      type: "ui/dm.send",
      dmId: "dm:v1:1:2",
      text: "hello",
    });
    expect(send.success).toBe(true);

    const state = ExtOutboundSchema.safeParse({
      type: "ext/dm.state",
      threads: [
        {
          dmId: "dm:v1:1:2",
          peer: {
            githubUserId: "2",
            login: "octocat",
            avatarUrl: "https://example.com/a.png",
            roles: [],
          },
          isBlocked: false,
          canTrustKey: false,
        },
      ],
    });
    expect(state.success).toBe(true);
  });

  it("rejects empty ui/link.open href", () => {
    const result = UiInboundSchema.safeParse({ type: "ui/link.open", href: "" });
    expect(result.success).toBe(false);
  });
});
