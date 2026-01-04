import { z } from "zod";
import { ChatRoom } from "./room.js";
import { DmRoom } from "./dm.js";
import { exchangeGithubTokenForSession } from "./session.js";
import { TelemetryEventSchema } from "@vscode-chat/protocol";
import { parseServerConfig } from "./config.js";
import { json } from "./http.js";
import { checkFixedWindowRateLimit, getClientIp, readRequestJsonWithLimit } from "./util.js";
import type { RateWindow } from "./util.js";

export interface Env {
  CHAT_ROOM: DurableObjectNamespace;
  DM_ROOM: DurableObjectNamespace;
  SESSION_SECRET: string;
  DENY_GITHUB_USER_IDS?: string;
  MODERATOR_GITHUB_USER_IDS?: string;
  CHAT_MESSAGE_RATE_WINDOW_MS?: string;
  CHAT_MESSAGE_RATE_MAX_COUNT?: string;
  CHAT_CONNECT_RATE_WINDOW_MS?: string;
  CHAT_CONNECT_RATE_MAX_COUNT?: string;
  CHAT_MAX_CONNECTIONS_PER_USER?: string;
  CHAT_MAX_CONNECTIONS_PER_ROOM?: string;
  CHAT_HISTORY_LIMIT?: string;
  CHAT_HISTORY_PERSIST_EVERY_N_MESSAGES?: string;
}

const ExchangeRequestSchema = z.object({
  accessToken: z.string().min(1),
});

export { ChatRoom };
export { DmRoom };

const AUTH_EXCHANGE_RATE_WINDOW_MS = 60_000;
const AUTH_EXCHANGE_RATE_MAX_COUNT = 10;
const AUTH_EXCHANGE_RATE_MAX_TRACKED_KEYS = 20_000;
const authExchangeRateByIp = new Map<string, RateWindow>();
const AUTH_EXCHANGE_MAX_BODY_BYTES = 2_048;

const TELEMETRY_RATE_WINDOW_MS = 60_000;
const TELEMETRY_RATE_MAX_COUNT = 120;
const TELEMETRY_RATE_MAX_TRACKED_KEYS = 20_000;
const telemetryRateByIp = new Map<string, RateWindow>();
const TELEMETRY_MAX_BODY_BYTES = 4_096;

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
} as const;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const configParsed = parseServerConfig(env);
    if (!configParsed.ok) {
      log({ type: "invalid_config", issues: configParsed.error.issues, scope: "worker" });
      return json({ error: "server_misconfigured" }, 500);
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/auth/exchange") {
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, 405, NO_STORE_HEADERS);
      }

      const clientIp = getClientIp(request);
      if (clientIp) {
        const rateCheck = checkFixedWindowRateLimit(clientIp, authExchangeRateByIp, {
          windowMs: AUTH_EXCHANGE_RATE_WINDOW_MS,
          maxCount: AUTH_EXCHANGE_RATE_MAX_COUNT,
          maxTrackedKeys: AUTH_EXCHANGE_RATE_MAX_TRACKED_KEYS,
        });
        if (!rateCheck.allowed) {
          log({
            type: "auth_exchange_rate_limited",
            retryAfterMs: rateCheck.retryAfterMs,
          });
          return json({ error: "rate_limited", retryAfterMs: rateCheck.retryAfterMs }, 429, {
            ...NO_STORE_HEADERS,
            "retry-after": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
          });
        }
      }

      const body = await readRequestJsonWithLimit(request, {
        maxBytes: AUTH_EXCHANGE_MAX_BODY_BYTES,
        timeoutMs: 1_000,
      });
      if (!body.ok) {
        return body.error === "too_large"
          ? json({ error: "payload_too_large" }, 413, NO_STORE_HEADERS)
          : json({ error: "invalid_json" }, 400, NO_STORE_HEADERS);
      }

      const parsed = ExchangeRequestSchema.safeParse(body.json);
      if (!parsed.success) {
        return json({ error: "invalid_payload" }, 400, NO_STORE_HEADERS);
      }

      try {
        const session = await exchangeGithubTokenForSession(parsed.data.accessToken, env);
        log({ type: "auth_exchange_success" });
        return json(session, 200, NO_STORE_HEADERS);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "auth_failed";
        log({ type: "auth_exchange_failed", message });
        return json({ error: "auth_failed", message }, 401, NO_STORE_HEADERS);
      }
    }

    if (url.pathname === "/telemetry") {
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, 405);
      }

      const clientIp = getClientIp(request);
      if (clientIp) {
        const rateCheck = checkFixedWindowRateLimit(clientIp, telemetryRateByIp, {
          windowMs: TELEMETRY_RATE_WINDOW_MS,
          maxCount: TELEMETRY_RATE_MAX_COUNT,
          maxTrackedKeys: TELEMETRY_RATE_MAX_TRACKED_KEYS,
        });
        if (!rateCheck.allowed) {
          return json({ error: "rate_limited", retryAfterMs: rateCheck.retryAfterMs }, 429, {
            "retry-after": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
          });
        }
      }

      const body = await readRequestJsonWithLimit(request, {
        maxBytes: TELEMETRY_MAX_BODY_BYTES,
        timeoutMs: 1_000,
      });
      if (!body.ok) {
        return body.error === "too_large"
          ? json({ error: "payload_too_large" }, 413)
          : json({ error: "invalid_json" }, 400);
      }

      const parsed = TelemetryEventSchema.safeParse(body.json);
      if (!parsed.success) {
        return json({ error: "invalid_payload" }, 400);
      }

      log({ type: "telemetry", event: parsed.data });
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }

      const id = env.CHAT_ROOM.idFromName("global");
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};

function log(event: Record<string, unknown>): void {
  // NOTE: Keep logs structured and privacy-preserving. Never include tokens, ciphertext, or key material.
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      ...event,
    }),
  );
}
