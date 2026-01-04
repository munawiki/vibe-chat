import { ChatMessagePlainSchema } from "@vscode-chat/protocol";
import type { ChatMessagePlain } from "@vscode-chat/protocol";
import type { ChatRoomGuardrails } from "../config.js";
import { DurableObjectHistory } from "../durableObjectHistory.js";
import { HISTORY_KEY } from "./constants.js";

export class ChatRoomHistory extends DurableObjectHistory<ChatMessagePlain> {
  constructor(
    state: DurableObjectState,
    config: Pick<ChatRoomGuardrails, "historyLimit" | "historyPersistEveryNMessages">,
  ) {
    super(state, HISTORY_KEY, ChatMessagePlainSchema, {
      limit: config.historyLimit,
      persistEveryNEntries: config.historyPersistEveryNMessages,
    });
  }
}
