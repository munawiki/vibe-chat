import { z } from "zod";
import { ChatRoom } from "./room.js";
import { exchangeGithubTokenForSession } from "./session.js";

export interface Env {
  CHAT_ROOM: DurableObjectNamespace;
  SESSION_SECRET: string;
}

const ExchangeRequestSchema = z.object({
  accessToken: z.string().min(1),
});

export { ChatRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/auth/exchange") {
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, 405);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      const parsed = ExchangeRequestSchema.safeParse(body);
      if (!parsed.success) {
        return json({ error: "invalid_payload" }, 400);
      }

      try {
        const session = await exchangeGithubTokenForSession(parsed.data.accessToken, env);
        return json(session, 200);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "auth_failed";
        return json({ error: "auth_failed", message }, 401);
      }
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
