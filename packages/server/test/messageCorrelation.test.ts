import { describe, expect, it } from "vitest";
import { GithubUserIdSchema } from "@vscode-chat/protocol";
import {
  createCorrelatedServerMessageNewEvents,
  pickCorrelatedServerMessageNewEvent,
} from "../src/room/messageCorrelation.js";

describe("message correlation", () => {
  const clientMessageId = "f2d6aa4f-2f60-4c25-b9f5-7a7b6a7bd3b0";
  const senderGithubUserId = GithubUserIdSchema.parse("1");
  const otherGithubUserId = GithubUserIdSchema.parse("2");

  it("creates sender-only clientMessageId events", () => {
    const events = createCorrelatedServerMessageNewEvents({
      message: {
        id: "m1",
        user: {
          githubUserId: senderGithubUserId,
          login: "alice",
          avatarUrl: "https://a.com",
          roles: [],
        },
        text: "hello",
        createdAt: new Date().toISOString(),
      },
      clientMessageId,
    });

    expect(events.publicEvent.clientMessageId).toBeUndefined();
    expect(events.senderEvent.clientMessageId).toBe(clientMessageId);

    expect(
      pickCorrelatedServerMessageNewEvent({
        recipientGithubUserId: senderGithubUserId,
        senderGithubUserId,
        events,
      }),
    ).toEqual(events.senderEvent);

    expect(
      pickCorrelatedServerMessageNewEvent({
        recipientGithubUserId: otherGithubUserId,
        senderGithubUserId,
        events,
      }),
    ).toEqual(events.publicEvent);

    expect(
      pickCorrelatedServerMessageNewEvent({
        recipientGithubUserId: undefined,
        senderGithubUserId,
        events,
      }),
    ).toEqual(events.publicEvent);
  });
});
