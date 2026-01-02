import { z } from "zod";

export type FixedWindowRateLimit = Readonly<{ windowMs: number; maxCount: number }>;

export type ChatRoomGuardrails = Readonly<{
  messageRate: FixedWindowRateLimit;
  connectRate: FixedWindowRateLimit;
  maxConnectionsPerUser: number;
  maxConnectionsPerRoom?: number;
  historyLimit: number;
  historyPersistEveryNMessages: number;
}>;

export type ServerConfig = Readonly<{
  chatRoom: ChatRoomGuardrails;
}>;

export type ServerConfigParseError = Readonly<{
  type: "invalid_config";
  issues: ReadonlyArray<Readonly<{ path: string; message: string }>>;
}>;

const Defaults = {
  messageRateWindowMs: 10_000,
  messageRateMaxCount: 5,
  connectRateWindowMs: 10_000,
  connectRateMaxCount: 20,
  maxConnectionsPerUser: 3,
  historyLimit: 200,
  historyPersistEveryNMessages: 1,
} as const;

function envNumberPreprocess(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    return Number(trimmed);
  }
  return value;
}

function envInt(options: {
  min: number;
  max: number;
  default: number;
}): z.ZodType<number, z.ZodTypeDef, unknown> {
  return z
    .preprocess(envNumberPreprocess, z.number().int().min(options.min).max(options.max))
    .default(options.default);
}

function envOptionalInt(options: {
  min: number;
  max: number;
}): z.ZodType<number | undefined, z.ZodTypeDef, unknown> {
  return z
    .preprocess(envNumberPreprocess, z.number().int().min(options.min).max(options.max))
    .optional();
}

const EnvGuardrailsSchema = z.object({
  CHAT_MESSAGE_RATE_WINDOW_MS: envInt({
    min: 100,
    max: 600_000,
    default: Defaults.messageRateWindowMs,
  }),
  CHAT_MESSAGE_RATE_MAX_COUNT: envInt({
    min: 1,
    max: 10_000,
    default: Defaults.messageRateMaxCount,
  }),
  CHAT_CONNECT_RATE_WINDOW_MS: envInt({
    min: 100,
    max: 600_000,
    default: Defaults.connectRateWindowMs,
  }),
  CHAT_CONNECT_RATE_MAX_COUNT: envInt({
    min: 1,
    max: 10_000,
    default: Defaults.connectRateMaxCount,
  }),
  CHAT_MAX_CONNECTIONS_PER_USER: envInt({
    min: 1,
    max: 100,
    default: Defaults.maxConnectionsPerUser,
  }),
  CHAT_MAX_CONNECTIONS_PER_ROOM: envOptionalInt({
    min: 1,
    max: 50_000,
  }),
  CHAT_HISTORY_LIMIT: envInt({
    min: 0,
    max: 10_000,
    default: Defaults.historyLimit,
  }),
  CHAT_HISTORY_PERSIST_EVERY_N_MESSAGES: envInt({
    min: 1,
    max: 10_000,
    default: Defaults.historyPersistEveryNMessages,
  }),
});

export function parseServerConfig(
  env: unknown,
): { ok: true; config: ServerConfig } | { ok: false; error: ServerConfigParseError } {
  const parsed = EnvGuardrailsSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return { ok: false, error: { type: "invalid_config", issues } };
  }

  const maxConnectionsPerRoom = parsed.data.CHAT_MAX_CONNECTIONS_PER_ROOM;
  const config: ServerConfig = {
    chatRoom: {
      messageRate: {
        windowMs: parsed.data.CHAT_MESSAGE_RATE_WINDOW_MS,
        maxCount: parsed.data.CHAT_MESSAGE_RATE_MAX_COUNT,
      },
      connectRate: {
        windowMs: parsed.data.CHAT_CONNECT_RATE_WINDOW_MS,
        maxCount: parsed.data.CHAT_CONNECT_RATE_MAX_COUNT,
      },
      maxConnectionsPerUser: parsed.data.CHAT_MAX_CONNECTIONS_PER_USER,
      ...(maxConnectionsPerRoom !== undefined ? { maxConnectionsPerRoom } : {}),
      historyLimit: parsed.data.CHAT_HISTORY_LIMIT,
      historyPersistEveryNMessages: parsed.data.CHAT_HISTORY_PERSIST_EVERY_N_MESSAGES,
    },
  };

  return { ok: true, config };
}

export function readServerConfig(env: unknown): ServerConfig {
  const parsed = parseServerConfig(env);
  if (parsed.ok) return parsed.config;

  const message = `invalid_config: ${parsed.error.issues
    .map((i) => `${i.path}:${i.message}`)
    .join(", ")}`;
  throw new Error(message);
}

export function readChatRoomGuardrails(env: unknown): ChatRoomGuardrails {
  return readServerConfig(env).chatRoom;
}
