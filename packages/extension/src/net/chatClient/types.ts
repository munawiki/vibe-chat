import type * as vscode from "vscode";
import type { ClientEvent, ServerEvent } from "@vscode-chat/protocol";
import type { ChatClientCoreEvent, ChatClientState } from "../../core/chatClientCore.js";

export interface AuthOrchestratorDeps {
  readonly output: vscode.LogOutputChannel;
  readonly run: (event: ChatClientCoreEvent) => Promise<void>;
  readonly getState: () => ChatClientState;
  readonly getBackendUrl: () => string;
  readonly onDidChangeGitHubSessions: (listener: () => void) => vscode.Disposable;
}

export interface WsConnectionManagerDeps {
  readonly sendClientEvent: (payload: ClientEvent) =>
    | {
        ok: true;
      }
    | {
        ok: false;
        reason: "not_open";
      }
    | {
        ok: false;
        reason: "send_failed";
        error: unknown;
      };
}

export interface DmBridgeDeps {
  readonly output: vscode.LogOutputChannel;
  readonly ws: WsConnectionManagerDeps;
}

export interface ClientEventBusDeps {
  readonly initialState: ChatClientState;
  readonly emitInitialOnSubscribe?: boolean;
  readonly output?: vscode.LogOutputChannel;
}

export interface ClientEventBusStateEvents {
  readonly state: ChatClientState;
}

export interface ClientEventBusServerEvents {
  readonly event: ServerEvent;
}
