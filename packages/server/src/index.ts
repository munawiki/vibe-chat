import { z } from "zod";
export { ChatRoom } from "./room/chatRoom.js";
export { DmRoom } from "./dm/dmRoom.js";
import { exchangeGithubTokenForSession } from "./session.js";
import { TelemetryEventSchema } from "@vscode-chat/protocol";
import { parseServerConfig } from "./config.js";
import {
  AUTH_EXCHANGE_MAX_BODY_BYTES,
  AUTH_EXCHANGE_RATE_MAX_COUNT,
  AUTH_EXCHANGE_RATE_WINDOW_MS,
  MAX_TRACKED_RATE_LIMIT_KEYS,
  REQUEST_BODY_TIMEOUT_MS,
  TELEMETRY_MAX_BODY_BYTES,
  TELEMETRY_RATE_MAX_COUNT,
  TELEMETRY_RATE_WINDOW_MS,
} from "./constants.js";
import { json } from "./http.js";
import { enforceFixedWindowRateLimit } from "./middleware/rateLimit.js";
import type { RateWindow } from "./util/rateLimitStore.js";
import { readRequestJsonWithLimit } from "./util/requestBody.js";
import { log } from "./util/structuredLog.js";

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

const authExchangeRateByIp = new Map<string, RateWindow>();

const telemetryRateByIp = new Map<string, RateWindow>();

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
} as const;

async function parseAuthExchangeBody(
  request: Request,
): Promise<{ ok: true; accessToken: string } | { ok: false; response: Response }> {
  const body = await readRequestJsonWithLimit(request, {
    maxBytes: AUTH_EXCHANGE_MAX_BODY_BYTES,
    timeoutMs: REQUEST_BODY_TIMEOUT_MS,
  });
  if (!body.ok) {
    return {
      ok: false,
      response:
        body.error === "too_large"
          ? json({ error: "payload_too_large" }, 413, NO_STORE_HEADERS)
          : json({ error: "invalid_json" }, 400, NO_STORE_HEADERS),
    };
  }

  const parsed = ExchangeRequestSchema.safeParse(body.json);
  if (!parsed.success) {
    return { ok: false, response: json({ error: "invalid_payload" }, 400, NO_STORE_HEADERS) };
  }
  return { ok: true, accessToken: parsed.data.accessToken };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const configParsed = parseServerConfig(env);
    if (!configParsed.ok) {
      log({ type: "invalid_config", issues: configParsed.error.issues, scope: "worker" });
      return json({ error: "server_misconfigured" }, 500);
    }

    const url = new URL(request.url);

    switch (url.pathname) {
      case "/health":
        return new Response("ok", { status: 200 });
      case "/auth/exchange":
        return handleAuthExchange(request, env);
      case "/telemetry":
        return handleTelemetry(request);
      case "/ws":
        return handleWebSocket(request, env);
      default:
        return new Response("Not found", { status: 404 });
    }
  },
};

async function handleAuthExchange(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, NO_STORE_HEADERS);
  }

  const rateLimitResponse = enforceFixedWindowRateLimit(request, authExchangeRateByIp, {
    windowMs: AUTH_EXCHANGE_RATE_WINDOW_MS,
    maxCount: AUTH_EXCHANGE_RATE_MAX_COUNT,
    maxTrackedKeys: MAX_TRACKED_RATE_LIMIT_KEYS,
    noStore: true,
  });
  if (rateLimitResponse) {
    const retryAfterMs = Number(rateLimitResponse.headers.get("retry-after") ?? "0") * 1000;
    log({ type: "auth_exchange_rate_limited", retryAfterMs });
    return rateLimitResponse;
  }

  const parsedBody = await parseAuthExchangeBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const session = await exchangeGithubTokenForSession(parsedBody.accessToken, env);
    log({ type: "auth_exchange_success" });
    return json(session, 200, NO_STORE_HEADERS);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "auth_failed";
    log({ type: "auth_exchange_failed", message });
    return json({ error: "auth_failed", message }, 401, NO_STORE_HEADERS);
  }
}

async function handleTelemetry(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const rateLimitResponse = enforceFixedWindowRateLimit(request, telemetryRateByIp, {
    windowMs: TELEMETRY_RATE_WINDOW_MS,
    maxCount: TELEMETRY_RATE_MAX_COUNT,
    maxTrackedKeys: MAX_TRACKED_RATE_LIMIT_KEYS,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const body = await readRequestJsonWithLimit(request, {
    maxBytes: TELEMETRY_MAX_BODY_BYTES,
    timeoutMs: REQUEST_BODY_TIMEOUT_MS,
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

function handleWebSocket(request: Request, env: Env): Promise<Response> | Response {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }

  const id = env.CHAT_ROOM.idFromName("global");
  const stub = env.CHAT_ROOM.get(id);
  return stub.fetch(request);
}
