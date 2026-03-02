import type { ExtensionTelemetry } from "../../telemetry.js";
import { getGitHubSession } from "../../adapters/vscodeAuth.js";
import { exchangeSession } from "../../adapters/sessionExchange.js";
import type { ChatClientCoreCommand, ChatClientCoreEvent } from "../../core/chatClientCore.js";
import type { WsConnectionManager } from "./wsConnectionManager.js";

type ExecuteContext = {
  telemetry: ExtensionTelemetry | undefined;
  wsConnectionManager: WsConnectionManager;
};

type CommandHandler = (
  cmd: ChatClientCoreCommand,
  context: ExecuteContext,
) => ChatClientCoreEvent | void | Promise<ChatClientCoreEvent | void>;

const handlers: Record<ChatClientCoreCommand["type"], CommandHandler> = {
  "cmd/github.session.get": (cmd) =>
    executeGithubSessionGet(asCommand(cmd, "cmd/github.session.get")),
  "cmd/auth.exchange": (cmd) => executeAuthExchange(asCommand(cmd, "cmd/auth.exchange")),
  "cmd/ws.open": (cmd, context) =>
    context.wsConnectionManager.openConnection({
      backendUrl: asCommand(cmd, "cmd/ws.open").backendUrl,
      token: asCommand(cmd, "cmd/ws.open").token,
    }),
  "cmd/ws.close": (cmd, context) => {
    const command = asCommand(cmd, "cmd/ws.close");
    context.wsConnectionManager.closeSocket(command.code, command.reason);
  },
  "cmd/reconnect.cancel": (_cmd, context) => {
    context.wsConnectionManager.cancelReconnect();
  },
  "cmd/reconnect.schedule": (cmd, context) => {
    context.wsConnectionManager.scheduleReconnect(asCommand(cmd, "cmd/reconnect.schedule").delayMs);
  },
  "cmd/telemetry.send": (cmd, context) => {
    const command = asCommand(cmd, "cmd/telemetry.send");
    if (command.event.name === "vscodeChat.ws.legacy_fallback") {
      context.wsConnectionManager.emitLegacyFallbackDiagnostic(command.event);
    }
    context.telemetry?.send(command.event as Parameters<ExtensionTelemetry["send"]>[0]);
  },
  "cmd/raise": (cmd) => {
    throw asCommand(cmd, "cmd/raise").error;
  },
};

export async function executeChatClientCommand(options: {
  cmd: ChatClientCoreCommand;
  wsConnectionManager: WsConnectionManager;
  telemetry: ExtensionTelemetry | undefined;
}): Promise<ChatClientCoreEvent | void> {
  const context: ExecuteContext = {
    wsConnectionManager: options.wsConnectionManager,
    telemetry: options.telemetry,
  };

  return Promise.resolve(handlers[options.cmd.type](options.cmd, context));
}

function asCommand<T extends ChatClientCoreCommand["type"]>(
  cmd: ChatClientCoreCommand,
  type: T,
): Extract<ChatClientCoreCommand, { type: T }> {
  if (cmd.type !== type) {
    throw new Error(`unexpected command type: expected ${type}, got ${cmd.type}`);
  }
  return cmd as Extract<ChatClientCoreCommand, { type: T }>;
}

async function executeGithubSessionGet(
  cmd: Extract<ChatClientCoreCommand, { type: "cmd/github.session.get" }>,
): Promise<ChatClientCoreEvent> {
  try {
    const session = cmd.interactive
      ? await getGitHubSession({
          interactive: true,
          ...(cmd.clearSessionPreference ? { clearSessionPreference: true } : {}),
        })
      : await getGitHubSession({ interactive: false });

    const nowMs = Date.now();
    return session
      ? { type: "github/session.result", ok: true, session, nowMs }
      : { type: "github/session.result", ok: false, nowMs };
  } catch (err) {
    return { type: "github/session.result", ok: false, nowMs: Date.now(), error: err };
  }
}

async function executeAuthExchange(
  cmd: Extract<ChatClientCoreCommand, { type: "cmd/auth.exchange" }>,
): Promise<ChatClientCoreEvent> {
  const result = await exchangeSession(cmd.backendUrl, cmd.accessToken);
  return result.ok
    ? { type: "auth/exchange.result", ok: true, session: result.session }
    : { type: "auth/exchange.result", ok: false, error: result.error };
}
