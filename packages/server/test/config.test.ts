import { describe, expect, it } from "vitest";
import { parseServerConfig } from "../src/config.js";

describe("server config", () => {
  it("uses defaults when env vars are missing", () => {
    const parsed = parseServerConfig({});
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.config).toEqual({
      chatRoom: {
        messageRate: { windowMs: 10_000, maxCount: 5 },
        connectRate: { windowMs: 10_000, maxCount: 20 },
        maxConnectionsPerUser: 3,
        historyLimit: 200,
        historyPersistEveryNMessages: 1,
      },
    });
    expect(parsed.config.chatRoom.maxConnectionsPerRoom).toBeUndefined();
  });

  it("parses integer env vars from strings", () => {
    const parsed = parseServerConfig({
      CHAT_MESSAGE_RATE_WINDOW_MS: "5000",
      CHAT_MESSAGE_RATE_MAX_COUNT: "2",
      CHAT_CONNECT_RATE_WINDOW_MS: "12000",
      CHAT_CONNECT_RATE_MAX_COUNT: "9",
      CHAT_MAX_CONNECTIONS_PER_USER: "1",
      CHAT_MAX_CONNECTIONS_PER_ROOM: "10",
      CHAT_HISTORY_LIMIT: "50",
      CHAT_HISTORY_PERSIST_EVERY_N_MESSAGES: "5",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.config.chatRoom).toEqual({
      messageRate: { windowMs: 5000, maxCount: 2 },
      connectRate: { windowMs: 12_000, maxCount: 9 },
      maxConnectionsPerUser: 1,
      maxConnectionsPerRoom: 10,
      historyLimit: 50,
      historyPersistEveryNMessages: 5,
    });
  });

  it("rejects invalid values", () => {
    const parsed = parseServerConfig({
      CHAT_MESSAGE_RATE_WINDOW_MS: "not-a-number",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    expect(parsed.error.type).toBe("invalid_config");
    expect(parsed.error.issues.map((i) => i.path)).toContain("CHAT_MESSAGE_RATE_WINDOW_MS");
  });
});
