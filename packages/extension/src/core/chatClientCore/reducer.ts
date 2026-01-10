import { assertNever } from "./helpers.js";
import type { ChatClientCoreCommand, ChatClientCoreEvent, ChatClientCoreState } from "./types.js";
import { handleAuthExchangeResult } from "./reducer/authExchangeResult.js";
import { handleGithubSessionResult } from "./reducer/githubSessionResult.js";
import { handleTimerReconnectFired } from "./reducer/timerReconnectFired.js";
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

export function reduceChatClientCore(
  state: ChatClientCoreState,
  event: ChatClientCoreEvent,
): { state: ChatClientCoreState; commands: ChatClientCoreCommand[] } {
  switch (event.type) {
    case "auth/refresh.requested":
      return handleAuthRefreshRequested(state, event);
    case "ui/signIn":
      return handleUiSignIn(state, event);
    case "ui/signOut":
      return handleUiSignOut(state, event);
    case "ui/connect":
      return handleUiConnect(state, event);
    case "ui/disconnect":
      return handleUiDisconnect(state, event);
    case "github/session.result":
      return handleGithubSessionResult(state, event);
    case "auth/exchange.result":
      return handleAuthExchangeResult(state, event);
    case "ws/open.result":
      return handleWsOpenResult(state, event);
    case "ws/welcome":
      return handleWsWelcome(state, event);
    case "ws/closed":
      return handleWsClosed(state, event);
    case "timer/reconnect.fired":
      return handleTimerReconnectFired(state, event);
    default:
      assertNever(event);
  }
}
