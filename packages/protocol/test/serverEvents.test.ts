import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, ServerEventSchema } from "../src/index.js";

describe("server event schemas", () => {
  const dmPublicKey = Buffer.alloc(32).toString("base64");
  const dmNonce = Buffer.alloc(24).toString("base64");
  const dmCiphertext = Buffer.from("ciphertext").toString("base64");

  it("rejects unknown server event type", () => {
    expect(
      ServerEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "server/unknown",
      }).success,
    ).toBe(false);
  });

  it("accepts welcome/message/presence events", () => {
    expect(
      ServerEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "server/welcome",
        user: { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" },
        serverTime: new Date().toISOString(),
        history: [],
      }).success,
    ).toBe(true);

    expect(
      ServerEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "server/message.new",
        message: {
          id: "m1",
          user: { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" },
          text: "hello",
          createdAt: new Date().toISOString(),
        },
      }).success,
    ).toBe(true);

    expect(
      ServerEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "server/presence",
        snapshot: [
          {
            user: {
              githubUserId: "123",
              login: "octocat",
              avatarUrl: "https://example.com/a.png",
            },
            connections: 2,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("accepts DM and moderation server events", () => {
    expect(
      ServerEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "server/dm.welcome",
        dmId: "dm:v1:1:2",
        peerGithubUserId: "2",
        peerIdentity: { cipherSuite: "nacl.box.v1", publicKey: dmPublicKey },
        history: [],
      }).success,
    ).toBe(true);

    expect(
      ServerEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "server/dm.message.new",
        message: {
          id: "m1",
          dmId: "dm:v1:1:2",
          sender: { githubUserId: "1", login: "alice", avatarUrl: "https://example.com/a.png" },
          recipientGithubUserId: "2",
          senderIdentity: { cipherSuite: "nacl.box.v1", publicKey: dmPublicKey },
          recipientIdentity: { cipherSuite: "nacl.box.v1", publicKey: dmPublicKey },
          nonce: dmNonce,
          ciphertext: dmCiphertext,
          createdAt: new Date().toISOString(),
        },
      }).success,
    ).toBe(true);

    expect(
      ServerEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "server/moderation.snapshot",
        operatorDeniedGithubUserIds: ["1"],
        roomDeniedGithubUserIds: ["2"],
      }).success,
    ).toBe(true);
  });
});
