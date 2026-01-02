import { z } from "zod";
import { ChatRoom } from "./room.js";
import { exchangeGithubTokenForSession } from "./session.js";
import { TelemetryEventSchema } from "@vscode-chat/protocol";
import { parseServerConfig } from "./config.js";
import { checkFixedWindowRateLimit, getClientIp } from "./util.js";
import type { RateWindow } from "./util.js";

export interface Env {
  CHAT_ROOM: DurableObjectNamespace;
  SESSION_SECRET: string;
  DENY_GITHUB_USER_IDS?: string;
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

const AUTH_EXCHANGE_RATE_WINDOW_MS = 60_000;
const AUTH_EXCHANGE_RATE_MAX_COUNT = 10;
const authExchangeRateByIp = new Map<string, RateWindow>();

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

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400, NO_STORE_HEADERS);
      }

      const parsed = ExchangeRequestSchema.safeParse(body);
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

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      const parsed = TelemetryEventSchema.safeParse(body);
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

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function log(event: Record<string, unknown>): void {
  // NOTE: Keep logs structured and privacy-preserving. Never include tokens or message text.
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      ...event,
    }),
  );
}
