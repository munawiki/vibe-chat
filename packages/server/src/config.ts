import { z } from "zod";

export type FixedWindowRateLimit = Readonly<{ windowMs: number; maxCount: number }>;

const SupportedContentPolicyLanguages = [
  "en",
  "ar",
  "de",
  "es",
  "fr",
  "it",
  "hi",
  "ja",
  "ko",
  "pt",
  "ru",
  "zh",
] as const;
export type ChatContentPolicyLanguage = (typeof SupportedContentPolicyLanguages)[number];

const DefaultContentPolicyLanguages = [
  "en",
  "ko",
] as const satisfies ReadonlyArray<ChatContentPolicyLanguage>;

export type ChatContentPolicyMode = "off" | "reject";

export type ChatContentPolicy = Readonly<{
  mode: ChatContentPolicyMode;
  languages: ReadonlyArray<ChatContentPolicyLanguage>;
  denylist: ReadonlyArray<string>;
  allowlist: ReadonlyArray<string>;
}>;

export type ChatRoomGuardrails = Readonly<{
  messageRate: FixedWindowRateLimit;
  connectRate: FixedWindowRateLimit;
  maxConnectionsPerUser: number;
  maxConnectionsPerRoom?: number;
  historyLimit: number;
  historyPersistEveryNMessages: number;
  contentPolicy: ChatContentPolicy;
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
  contentFilterMode: "off" satisfies ChatContentPolicyMode,
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

function envStringPreprocess(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    return trimmed;
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

function envEnum<const T extends Readonly<[string, ...string[]]>>(options: {
  values: T;
  default: T[number];
}): z.ZodType<T[number], z.ZodTypeDef, unknown> {
  return z.preprocess(envStringPreprocess, z.enum(options.values)).default(options.default);
}

function parseCommaOrNewlineSeparatedList(value: string): string[] {
  if (value.trim().length === 0) return [];
  const parts = value.split(/[,\n]/g);
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of parts) {
    const item = raw.trim().toLowerCase();
    if (item.length === 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    list.push(item);
  }
  return list;
}

const EnvGuardrailsSchema = z
  .object({
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
    CHAT_CONTENT_FILTER_MODE: envEnum({
      values: ["off", "reject"],
      default: Defaults.contentFilterMode,
    }),
    CHAT_CONTENT_FILTER_LANGUAGES: z
      .preprocess(
        (value: unknown) => {
          const preprocessed = envStringPreprocess(value);
          if (preprocessed === undefined) return undefined;
          if (typeof preprocessed !== "string") return preprocessed;

          const parts = parseCommaOrNewlineSeparatedList(preprocessed);
          if (parts.includes("all")) return [...SupportedContentPolicyLanguages];
          return parts;
        },
        z
          .array(z.enum(SupportedContentPolicyLanguages))
          .min(1)
          .max(SupportedContentPolicyLanguages.length),
      )
      .default([...DefaultContentPolicyLanguages]),
    CHAT_CONTENT_DENYLIST: z
      .preprocess(
        (value: unknown) => {
          const preprocessed = envStringPreprocess(value);
          if (preprocessed === undefined) return undefined;
          if (typeof preprocessed !== "string") return preprocessed;
          return parseCommaOrNewlineSeparatedList(preprocessed);
        },
        z.array(z.string().min(1)).max(1000),
      )
      .default([]),
    CHAT_CONTENT_ALLOWLIST: z
      .preprocess(
        (value: unknown) => {
          const preprocessed = envStringPreprocess(value);
          if (preprocessed === undefined) return undefined;
          if (typeof preprocessed !== "string") return preprocessed;
          return parseCommaOrNewlineSeparatedList(preprocessed);
        },
        z.array(z.string().min(1)).max(1000),
      )
      .default([]),
  })
  .superRefine((data, ctx) => {
    if (
      data.CHAT_CONTENT_FILTER_MODE === "reject" &&
      data.CHAT_CONTENT_FILTER_LANGUAGES.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CHAT_CONTENT_FILTER_LANGUAGES"],
        message: "Required when CHAT_CONTENT_FILTER_MODE=reject",
      });
    }
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
      contentPolicy: {
        mode: parsed.data.CHAT_CONTENT_FILTER_MODE,
        languages: parsed.data.CHAT_CONTENT_FILTER_LANGUAGES,
        denylist: parsed.data.CHAT_CONTENT_DENYLIST,
        allowlist: parsed.data.CHAT_CONTENT_ALLOWLIST,
      },
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
