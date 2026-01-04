import { describe, expect, it } from "vitest";
import { parseServerConfig } from "../src/config.js";

type ServerConfigParseResult = ReturnType<typeof parseServerConfig>;
type ValidServerConfig = Extract<ServerConfigParseResult, { ok: true }>["config"];
type InvalidServerConfig = Extract<ServerConfigParseResult, { ok: false }>;

function parseConfigOk(env: unknown): ValidServerConfig {
  const parsed = parseServerConfig(env);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("expected valid config");
  return parsed.config;
}

function parseConfigInvalid(env: unknown): InvalidServerConfig {
  const parsed = parseServerConfig(env);
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error("expected invalid config");
  expect(parsed.error.type).toBe("invalid_config");
  return parsed;
}

function expectEmptyUserIdSets(config: ValidServerConfig): void {
  expect([...config.operatorDeniedGithubUserIds]).toEqual([]);
  expect([...config.moderatorGithubUserIds]).toEqual([]);
}

function expectInvalidPaths(parsed: InvalidServerConfig, ...paths: string[]): void {
  expect(parsed.error.issues.map((i) => i.path)).toEqual(expect.arrayContaining(paths));
}

describe("server config", () => {
  it("uses defaults when env vars are missing", () => {
    const config = parseConfigOk({});

    expectEmptyUserIdSets(config);
    expect(config.chatRoom).toEqual({
      messageRate: { windowMs: 10_000, maxCount: 5 },
      connectRate: { windowMs: 10_000, maxCount: 20 },
      maxConnectionsPerUser: 3,
      historyLimit: 200,
      historyPersistEveryNMessages: 1,
    });
    expect(config.chatRoom.maxConnectionsPerRoom).toBeUndefined();
  });

  it("parses integer env vars from strings", () => {
    const config = parseConfigOk({
      CHAT_MESSAGE_RATE_WINDOW_MS: "5000",
      CHAT_MESSAGE_RATE_MAX_COUNT: "2",
      CHAT_CONNECT_RATE_WINDOW_MS: "12000",
      CHAT_CONNECT_RATE_MAX_COUNT: "9",
      CHAT_MAX_CONNECTIONS_PER_USER: "1",
      CHAT_MAX_CONNECTIONS_PER_ROOM: "10",
      CHAT_HISTORY_LIMIT: "50",
      CHAT_HISTORY_PERSIST_EVERY_N_MESSAGES: "5",
    });

    expectEmptyUserIdSets(config);
    expect(config.chatRoom).toEqual({
      messageRate: { windowMs: 5000, maxCount: 2 },
      connectRate: { windowMs: 12_000, maxCount: 9 },
      maxConnectionsPerUser: 1,
      maxConnectionsPerRoom: 10,
      historyLimit: 50,
      historyPersistEveryNMessages: 5,
    });
  });

  it("parses GitHub numeric user id lists", () => {
    const config = parseConfigOk({
      DENY_GITHUB_USER_IDS: "1, 2,3",
      MODERATOR_GITHUB_USER_IDS: "73450925",
    });

    expect([...config.operatorDeniedGithubUserIds]).toEqual(["1", "2", "3"]);
    expect([...config.moderatorGithubUserIds]).toEqual(["73450925"]);
  });

  it("rejects invalid values", () => {
    const parsed = parseConfigInvalid({
      CHAT_MESSAGE_RATE_WINDOW_MS: "not-a-number",
    });

    expectInvalidPaths(parsed, "CHAT_MESSAGE_RATE_WINDOW_MS");
  });

  it("rejects invalid operator denylist user ids", () => {
    const parsed = parseConfigInvalid({
      DENY_GITHUB_USER_IDS: "123,abc",
    });

    expectInvalidPaths(parsed, "DENY_GITHUB_USER_IDS");
  });

  it("rejects invalid moderator allowlist user ids", () => {
    const parsed = parseConfigInvalid({
      MODERATOR_GITHUB_USER_IDS: "73450925,abc",
    });

    expectInvalidPaths(parsed, "MODERATOR_GITHUB_USER_IDS");
  });
});
