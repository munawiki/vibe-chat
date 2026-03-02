import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  SessionExchangeResponseSchema,
  TelemetryEventSchema,
  WsHandshakeRejectionSchema,
} from "../src/index.js";

describe("common protocol schemas", () => {
  it("accepts session exchange response", () => {
    expect(
      SessionExchangeResponseSchema.safeParse({
        token: "token",
        expiresAt: new Date().toISOString(),
        user: { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" },
      }).success,
    ).toBe(true);
  });

  it("accepts and rejects telemetry variants", () => {
    expect(
      TelemetryEventSchema.safeParse({
        name: "vscodeChat.ws.connect",
        outcome: "success",
        usedCachedSession: true,
      }).success,
    ).toBe(true);

    expect(
      TelemetryEventSchema.safeParse({
        name: "vscodeChat.ws.legacy_fallback",
        fallback: "handshake_429_body",
        kind: "too_many_connections",
      }).success,
    ).toBe(true);

    expect(TelemetryEventSchema.safeParse({ name: "vscodeChat.unknown" }).success).toBe(false);
    expect(
      TelemetryEventSchema.safeParse({
        name: "vscodeChat.ws.legacy_fallback",
        fallback: "handshake_429_body",
        kind: "other_cluster_shape",
      }).success,
    ).toBe(false);
  });

  it("validates ws handshake rejection schema", () => {
    expect(
      WsHandshakeRejectionSchema.safeParse({
        code: "rate_limited",
        message: "Too many connection attempts",
        retryAfterMs: 10_000,
      }).success,
    ).toBe(true);

    expect(
      WsHandshakeRejectionSchema.safeParse({
        // @ts-expect-error test invalid discriminator
        code: "unknown",
        message: "bad",
      }).success,
    ).toBe(false);
  });

  it("accepts server/error shape with client correlation", () => {
    const result = {
      version: PROTOCOL_VERSION,
      type: "server/error",
      code: "rate_limited",
      message: "Too many messages",
      retryAfterMs: 10_000,
      clientMessageId: "f2d6aa4f-2f60-4c25-b9f5-7a7b6a7bd3b0",
    };
    expect(result.type).toBe("server/error");
  });
});
