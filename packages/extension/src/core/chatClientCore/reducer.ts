import type { ChatClientCoreCommand, ChatClientCoreEvent, ChatClientCoreState } from "./types.js";
import { handleAuthExchangeResult } from "./reducer/authExchangeResult.js";
import { handleGithubSessionResult } from "./reducer/githubSessionResult.js";
import { handleTimerReconnectFired } from "./reducer/timerReconnectFired.js";
import type { ReduceResult } from "./reducer/types.js";
import {
  handleAuthRefreshRequested,
  handleUiConnect,
  handleUiDisconnect,
  handleUiSignIn,
  handleUiSignOut,
} from "./reducer/ui.js";
import { handleWsClosed } from "./reducer/wsClosed.js";
import { handleWsOpenResult } from "./reducer/wsOpenResult.js";
import { handleWsWelcome } from "./reducer/wsWelcome.js";

type EventHandlerMap = {
  [Type in ChatClientCoreEvent["type"]]: (
    state: ChatClientCoreState,
    event: Extract<ChatClientCoreEvent, { type: Type }>,
  ) => ReduceResult;
};

const EVENT_HANDLERS: EventHandlerMap = {
  "auth/refresh.requested": handleAuthRefreshRequested,
  "ui/signIn": handleUiSignIn,
  "ui/signOut": handleUiSignOut,
  "ui/connect": handleUiConnect,
  "ui/disconnect": handleUiDisconnect,
  "github/session.result": handleGithubSessionResult,
  "auth/exchange.result": handleAuthExchangeResult,
  "ws/open.result": handleWsOpenResult,
  "ws/welcome": handleWsWelcome,
  "ws/closed": handleWsClosed,
  "timer/reconnect.fired": handleTimerReconnectFired,
};

export function reduceChatClientCore(
  state: ChatClientCoreState,
  event: ChatClientCoreEvent,
): { state: ChatClientCoreState; commands: ChatClientCoreCommand[] } {
  const handler = EVENT_HANDLERS[event.type];
  return handler(state, event as never);
}
