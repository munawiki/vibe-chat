import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_TEXT_MAX_LEN,
  ClientEventSchema,
  DmIdSchema,
  GithubUserIdSchema,
  PROTOCOL_VERSION,
  ServerEventSchema,
  SessionExchangeResponseSchema,
  TelemetryEventSchema,
  WsHandshakeRejectionSchema,
  dmIdFromParticipants,
  dmIdParticipants,
} from "../src/index.js";

describe("protocol schemas", () => {
  const dmPublicKey = Buffer.alloc(32).toString("base64");
  const dmNonce = Buffer.alloc(24).toString("base64");
  const dmCiphertext = Buffer.from("ciphertext").toString("base64");

  it("accepts client/hello", () => {
    const result = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/hello",
      client: { name: "vscode", version: "1.0.0" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts client/message.send with plaintext", () => {
    const result = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/message.send",
      text: "hello",
    });
    expect(result.success).toBe(true);
  });

  it("accepts client/message.send with clientMessageId", () => {
    const result = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/message.send",
      text: "hello",
      clientMessageId: "f2d6aa4f-2f60-4c25-b9f5-7a7b6a7bd3b0",
    });
    expect(result.success).toBe(true);
  });

  it("rejects client/message.send with invalid clientMessageId", () => {
    const result = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/message.send",
      text: "hello",
      clientMessageId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects client/message.send over plaintext limit", () => {
    const result = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/message.send",
      text: "A".repeat(CHAT_MESSAGE_TEXT_MAX_LEN + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts DM client events", () => {
    const publish = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/dm.identity.publish",
      identity: { cipherSuite: "nacl.box.v1", publicKey: dmPublicKey },
    });
    expect(publish.success).toBe(true);

    const open = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/dm.open",
      targetGithubUserId: "123",
    });
    expect(open.success).toBe(true);

    const send = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/dm.message.send",
      dmId: "dm:v1:1:2",
      recipientGithubUserId: "2",
      senderIdentity: { cipherSuite: "nacl.box.v1", publicKey: dmPublicKey },
      recipientIdentity: { cipherSuite: "nacl.box.v1", publicKey: dmPublicKey },
      nonce: dmNonce,
      ciphertext: dmCiphertext,
    });
    expect(send.success).toBe(true);
  });

  it("rejects unknown server event type", () => {
    const result = ServerEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "server/unknown",
    });
    expect(result.success).toBe(false);
  });

  it("accepts server/welcome with plaintext history", () => {
    const result = ServerEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "server/welcome",
      user: { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" },
      serverTime: new Date().toISOString(),
      history: [
        {
          id: "m1",
          user: { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" },
          text: "hello",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts server/message.new with clientMessageId", () => {
    const result = ServerEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "server/message.new",
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

  it("accepts DM server events", () => {
    const welcome = ServerEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "server/dm.welcome",
      dmId: "dm:v1:1:2",
      peerGithubUserId: "2",
      peerIdentity: { cipherSuite: "nacl.box.v1", publicKey: dmPublicKey },
      history: [],
    });
    expect(welcome.success).toBe(true);

    const messageNew = ServerEventSchema.safeParse({
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
    });
    expect(messageNew.success).toBe(true);
  });

  it("accepts server/presence snapshot", () => {
    const result = ServerEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "server/presence",
      snapshot: [
        {
          user: { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" },
          connections: 2,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts client moderation events", () => {
    const deny = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/moderation.user.deny",
      targetGithubUserId: "123",
      reason: "spam",
    });
    expect(deny.success).toBe(true);

    const allow = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/moderation.user.allow",
      targetGithubUserId: "123",
    });
    expect(allow.success).toBe(true);
  });

  it("accepts server moderation events", () => {
    const snapshot = ServerEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "server/moderation.snapshot",
      operatorDeniedGithubUserIds: ["1"],
      roomDeniedGithubUserIds: ["2"],
    });
    expect(snapshot.success).toBe(true);

    const denied = ServerEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "server/moderation.user.denied",
      actorGithubUserId: "1",
      targetGithubUserId: "2",
    });
    expect(denied.success).toBe(true);

    const allowed = ServerEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "server/moderation.user.allowed",
      actorGithubUserId: "1",
      targetGithubUserId: "2",
    });
    expect(allowed.success).toBe(true);
  });

  it("accepts server/error for forbidden", () => {
    const result = ServerEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "server/error",
      code: "forbidden",
      message: "Moderator role required",
    });
    expect(result.success).toBe(true);
  });

  it("accepts server/error with clientMessageId", () => {
    const result = ServerEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "server/error",
      code: "rate_limited",
      message: "Too many messages",
      retryAfterMs: 10_000,
      clientMessageId: "f2d6aa4f-2f60-4c25-b9f5-7a7b6a7bd3b0",
    });
    expect(result.success).toBe(true);
  });

  it("accepts session exchange response", () => {
    const result = SessionExchangeResponseSchema.safeParse({
      token: "token",
      expiresAt: new Date().toISOString(),
      user: { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts known telemetry events", () => {
    const result = TelemetryEventSchema.safeParse({
      name: "vscodeChat.ws.connect",
      outcome: "success",
      usedCachedSession: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown telemetry events", () => {
    const result = TelemetryEventSchema.safeParse({
      name: "vscodeChat.unknown",
    });
    expect(result.success).toBe(false);
  });

  it("accepts ws handshake rejection rate_limited", () => {
    const result = WsHandshakeRejectionSchema.safeParse({
      code: "rate_limited",
      message: "Too many connection attempts",
      retryAfterMs: 10_000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown ws handshake rejection code", () => {
    const result = WsHandshakeRejectionSchema.safeParse({
      // @ts-expect-error - validation
      code: "unknown",
    });
    expect(result.success).toBe(false);
  });
});

describe("dmId helpers", () => {
  it("derives a stable canonical dmId", () => {
    const a = GithubUserIdSchema.parse("1");
    const b = GithubUserIdSchema.parse("2");

    expect(dmIdFromParticipants(a, b)).toBe("dm:v1:1:2");
    expect(dmIdFromParticipants(b, a)).toBe("dm:v1:1:2");
  });

  it("extracts dmId participants in canonical order", () => {
    const dmId = DmIdSchema.parse("dm:v1:1:2");
    const participants = dmIdParticipants(dmId);
    expect(participants).toEqual({ a: "1", b: "2" });
  });

  it("rejects non-canonical dmId", () => {
    const result = DmIdSchema.safeParse("dm:v1:2:1");
    expect(result.success).toBe(false);
  });
});
