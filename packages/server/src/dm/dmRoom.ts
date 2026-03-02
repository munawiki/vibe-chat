import { DmMessageCipherSchema } from "@vscode-chat/protocol";
import type { DmMessageCipher } from "@vscode-chat/protocol";
import { readChatRoomGuardrails } from "../config.js";
import { json } from "../http.js";
import { DurableObjectHistory } from "../durableObjectHistory.js";
import { readRequestJsonWithLimit } from "../util/requestBody.js";

const DM_HISTORY_KEY = "dm_history";

type ValidatedDmRequest =
  | { action: "history" }
  | { action: "append"; user: { kind: "internal_dm_service" } };

function validateDmRequest(
  request: Request,
  _env: unknown,
): { ok: true; validated: ValidatedDmRequest } | { ok: false; response: Response } {
  const url = new URL(request.url);

  if (url.pathname === "/history") {
    if (request.method !== "GET") {
      return { ok: false, response: new Response("Method not allowed", { status: 405 }) };
    }
    return { ok: true, validated: { action: "history" } };
  }

  if (url.pathname === "/append") {
    if (request.method !== "POST") {
      return { ok: false, response: new Response("Method not allowed", { status: 405 }) };
    }
    return { ok: true, validated: { action: "append", user: { kind: "internal_dm_service" } } };
  }

  return { ok: false, response: new Response("Not found", { status: 404 }) };
}

async function routeDmAction(options: {
  request: Request;
  history: DurableObjectHistory<DmMessageCipher>;
  validated: ValidatedDmRequest;
}): Promise<Response> {
  if (options.validated.action === "history") {
    await options.history.ready;
    return json({ history: options.history.snapshot() });
  }

  const body = await readRequestJsonWithLimit(options.request, { maxBytes: 32_768, timeoutMs: 1_000 });
  if (!body.ok) {
    return body.error === "too_large"
      ? json({ error: "payload_too_large" }, 413)
      : json({ error: "invalid_json" }, 400);
  }

  const parsed = DmMessageCipherSchema.safeParse(body.json);
  if (!parsed.success) return json({ error: "invalid_payload" }, 400);

  await options.history.ready;
  await options.history.append(parsed.data);
  return new Response(null, { status: 204 });
}

export class DmRoom implements DurableObject {
  private readonly history: DurableObjectHistory<DmMessageCipher>;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {
    const guardrails = readChatRoomGuardrails(env);
    this.history = new DurableObjectHistory(this.state, DM_HISTORY_KEY, DmMessageCipherSchema, {
      limit: guardrails.historyLimit,
      persistEveryNEntries: guardrails.historyPersistEveryNMessages,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const validated = validateDmRequest(request, this.env);
    if (!validated.ok) return validated.response;

    return routeDmAction({
      request,
      history: this.history,
      validated: validated.validated,
    });
  }
}
