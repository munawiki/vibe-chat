import type * as vscode from "vscode";
import { UiInboundSchema, type UiInbound } from "../../contract/webviewProtocol.js";

type HandlerMap = {
  [T in UiInbound["type"]]: (msg: Extract<UiInbound, { type: T }>) => void | Promise<void>;
};

export function createUiMessageRouter(options: {
  output: vscode.LogOutputChannel;
  handlers: HandlerMap;
}): (msg: unknown) => Promise<void> {
  return async (msg: unknown) => {
    const parsed = UiInboundSchema.safeParse(msg);
    if (!parsed.success) {
      options.output.warn("Invalid UI message schema.");
      return;
    }

    const handler = options.handlers[parsed.data.type] as (msg: UiInbound) => void | Promise<void>;
    await handler(parsed.data);
  };
}
