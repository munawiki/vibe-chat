import { describe, expect, it } from "vitest";
import { CHAT_MESSAGE_TEXT_MAX_LEN, ClientEventSchema, PROTOCOL_VERSION } from "../src/index.js";

describe("client event schemas", () => {
  it("accepts hello and message.send variants", () => {
    expect(
      ClientEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "client/hello",
        client: { name: "vscode", version: "1.0.0" },
      }).success,
    ).toBe(true);

    expect(
      ClientEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "client/message.send",
        text: "hello",
        clientMessageId: "f2d6aa4f-2f60-4c25-b9f5-7a7b6a7bd3b0",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid message.send payloads", () => {
    expect(
      ClientEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "client/message.send",
        text: "hello",
        clientMessageId: "not-a-uuid",
      }).success,
    ).toBe(false);

    expect(
      ClientEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "client/message.send",
        text: "A".repeat(CHAT_MESSAGE_TEXT_MAX_LEN + 1),
      }).success,
    ).toBe(false);
  });

  it("accepts DM and moderation client events", () => {
    const dmPublicKey = Buffer.alloc(32).toString("base64");
    const dmNonce = Buffer.alloc(24).toString("base64");
    const dmCiphertext = Buffer.from("ciphertext").toString("base64");

    expect(
      ClientEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "client/dm.identity.publish",
        identity: { cipherSuite: "nacl.box.v1", publicKey: dmPublicKey },
      }).success,
    ).toBe(true);

    expect(
      ClientEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "client/dm.message.send",
        dmId: "dm:v1:1:2",
        recipientGithubUserId: "2",
        senderIdentity: { cipherSuite: "nacl.box.v1", publicKey: dmPublicKey },
        recipientIdentity: { cipherSuite: "nacl.box.v1", publicKey: dmPublicKey },
        nonce: dmNonce,
        ciphertext: dmCiphertext,
      }).success,
    ).toBe(true);

    expect(
      ClientEventSchema.safeParse({
        version: PROTOCOL_VERSION,
        type: "client/moderation.user.deny",
        targetGithubUserId: "123",
        reason: "spam",
      }).success,
    ).toBe(true);
  });
});
