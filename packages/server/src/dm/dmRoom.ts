import { DmMessageCipherSchema } from "@vscode-chat/protocol";
import type { DmMessageCipher } from "@vscode-chat/protocol";
import { readChatRoomGuardrails } from "../config.js";
import { json } from "../http.js";
import { DurableObjectHistory } from "../durableObjectHistory.js";
import { readRequestJsonWithLimit } from "../util.js";

const DM_HISTORY_KEY = "dm_history";

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
    const url = new URL(request.url);

    if (url.pathname === "/history") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      await this.history.ready;
      return json({ history: this.history.snapshot() });
    }

    if (url.pathname === "/append") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

      const body = await readRequestJsonWithLimit(request, { maxBytes: 32_768, timeoutMs: 1_000 });
      if (!body.ok) {
        return body.error === "too_large"
          ? json({ error: "payload_too_large" }, 413)
          : json({ error: "invalid_json" }, 400);
      }

      const parsed = DmMessageCipherSchema.safeParse(body.json);
      if (!parsed.success) return json({ error: "invalid_payload" }, 400);

      await this.history.ready;
      await this.history.append(parsed.data);
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }
}
