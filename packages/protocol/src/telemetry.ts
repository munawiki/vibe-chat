import { z } from "zod";

const AuthExchangeEventSchema = z.object({
  name: z.literal("vscodeChat.auth.exchange"),
  outcome: z.enum(["success", "http_error", "invalid_response", "network_error"]),
  httpStatus: z.number().int().positive().optional(),
});

const WebSocketConnectEventSchema = z.object({
  name: z.literal("vscodeChat.ws.connect"),
  outcome: z.enum(["success", "handshake_http_error", "network_error"]),
  httpStatus: z.number().int().positive().optional(),
  usedCachedSession: z.boolean(),
  recovered: z.boolean().optional(),
});

const WebSocketReconnectScheduledEventSchema = z.object({
  name: z.literal("vscodeChat.ws.reconnect_scheduled"),
  attempt: z.number().int().nonnegative(),
  delayMs: z.number().int().nonnegative(),
});

const WebSocketLegacyFallbackEventSchema = z.object({
  name: z.literal("vscodeChat.ws.legacy_fallback"),
  fallback: z.literal("handshake_429_body"),
  kind: z.enum(["rate_limited", "room_full", "too_many_connections", "unknown"]),
});

export const TelemetryEventSchema = z.discriminatedUnion("name", [
  AuthExchangeEventSchema,
  WebSocketConnectEventSchema,
  WebSocketReconnectScheduledEventSchema,
  WebSocketLegacyFallbackEventSchema,
]);
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
