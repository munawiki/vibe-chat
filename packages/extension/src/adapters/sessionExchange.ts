import { SessionExchangeResponseSchema } from "@vscode-chat/protocol";
import type { AuthUser } from "@vscode-chat/protocol";
import type { AuthExchangeError } from "../core/chatClientCore.js";

export type ExchangeSessionResult =
  | { ok: true; session: { token: string; expiresAtMs: number; user: AuthUser } }
  | { ok: false; error: AuthExchangeError };

export async function exchangeSession(
  backendUrl: string,
  accessToken: string,
): Promise<ExchangeSessionResult> {
  const url = `${backendUrl}/auth/exchange`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });
  } catch {
    return { ok: false, error: { type: "network_error" } };
  }

  if (!response.ok) {
    return { ok: false, error: { type: "http", status: response.status } };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, error: { type: "invalid_response" } };
  }

  const parsed = SessionExchangeResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: { type: "invalid_response" } };
  }

  const expiresAtMs = Date.parse(parsed.data.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return { ok: false, error: { type: "invalid_response" } };
  }

  return {
    ok: true,
    session: { token: parsed.data.token, expiresAtMs, user: parsed.data.user },
  };
}
