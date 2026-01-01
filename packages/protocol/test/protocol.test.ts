import { describe, expect, it } from "vitest";
import {
  ClientEventSchema,
  PROTOCOL_VERSION,
  ServerEventSchema,
  SessionExchangeResponseSchema,
  TelemetryEventSchema,
} from "../src/index.js";

describe("protocol schemas", () => {
  it("accepts client/message.send with <= 500 chars", () => {
    const result = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/message.send",
      text: "hello",
    });
    expect(result.success).toBe(true);
  });

  it("rejects client/message.send over limit", () => {
    const result = ClientEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "client/message.send",
      text: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown server event type", () => {
    const result = ServerEventSchema.safeParse({
      version: PROTOCOL_VERSION,
      type: "server/unknown",
    });
    expect(result.success).toBe(false);
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
});
